import { randomUUID } from "node:crypto";

import { PROVIDERS } from "../config/providers.js";
import { BaseExecutor } from "./base.js";
import { parseT3ChatTextResponse } from "./t3chatParser.js";
import {
	buildT3ChatHeaders,
	buildT3ChatPayload,
	getT3ChatCredentials,
} from "./t3chatPayload.js";
import { T3ChatTransport } from "./t3chatTransport.js";

/**
 * T3Chat Executor - MUST use wreq-js HTTP client exclusively
 *
 * IMPORTANT: This executor is hardcoded to use T3ChatTransport which loads wreq-js.
 * T3Chat requires browser-like fingerprinting that only wreq-js provides.
 * Do NOT modify this to use native fetch, axios, got, or any other HTTP client.
 *
 * The T3ChatTransport validates that wreq-js is loaded and will throw an error
 * if it detects any fallback to other HTTP clients.
 */

const CHAT_URL = "https://t3.chat/api/chat";
let transportFactory = null;

function createTextResponse(text, status = 200, model = "t3chat") {
	return new Response(
		JSON.stringify({
			id: `chatcmpl-${randomUUID()}`,
			object: "chat.completion",
			created: Math.floor(Date.now() / 1000),
			model,
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: text },
					finish_reason: "stop",
				},
			],
		}),
		{
			status,
			headers: { "Content-Type": "application/json" },
		},
	);
}

export class T3ChatExecutor extends BaseExecutor {
	constructor() {
		super("t3chat", PROVIDERS.t3chat);
	}

	buildUrl() {
		return CHAT_URL;
	}

	async execute({ model, body, stream, credentials, signal, log }) {
		// VALIDATION: Ensure we're using wreq-js transport, not base executor's fetch
		const threadId = randomUUID();
		const responseMessageId = randomUUID();
		const { cookies } = getT3ChatCredentials(credentials);
		const headers = buildT3ChatHeaders({ cookies, threadId });
		const transformedBody = buildT3ChatPayload({
			model,
			body,
			credentials,
			threadId,
			responseMessageId,
		});

		// Create transport instance - this will validate wreq-js is loaded
		const transport = transportFactory
			? transportFactory()
			: new T3ChatTransport();

		// Validate transport is T3ChatTransport (not a different HTTP client)
		if (!(transport instanceof T3ChatTransport)) {
			throw new Error(
				"T3Chat provider MUST use T3ChatTransport with wreq-js. " +
					"Detected invalid transport instance.",
			);
		}

		log?.debug?.("FETCH", `T3CHAT → ${CHAT_URL}`);

		// T3Chat always returns SSE, so we use transport.post for both streaming and non-streaming
		// The transport returns a native Response object that 9router can handle
		const upstream = await transport.post(CHAT_URL, {
			headers,
			json: transformedBody,
			signal,
		});

		if (upstream.status === 401 || upstream.status === 403) {
			throw new Error(
				"T3Chat rejected the provided session. Refresh cookies and convexSessionId.",
			);
		}
		if (upstream.status === 429) {
			throw new Error(
				"T3Chat returned HTTP 429. This can mean rate limiting or browser-fingerprint rejection; retry later and refresh credentials if it persists.",
			);
		}
		if (upstream.status >= 400) {
			// Error text already read by transport
			const errorText = upstream.text || "";
			throw new Error(
				`T3Chat returned HTTP ${upstream.status}. ${errorText ? "Error: " + errorText.substring(0, 200) : ""}`,
			);
		}

		// For non-streaming, read the SSE stream and parse into a completion
		if (!stream) {
			// T3Chat always returns SSE, so we need to read the stream
			let sseText = upstream.text;
			if (!sseText && upstream.response) {
				// Read the streaming response as text
				sseText = await upstream.response.text();
			}
			const text = parseT3ChatTextResponse(sseText);
			return {
				response: createTextResponse(text, 200, model),
				url: CHAT_URL,
				headers,
				transformedBody,
			};
		}

		// For streaming, return the Response directly but convert T3Chat SSE to OpenAI format
		const transformedStream = upstream.response.body.pipeThrough(
			new TransformStream({
				transform(chunk, controller) {
					const text = new TextDecoder().decode(chunk);
					const lines = text.split("\n");

					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed.startsWith("data:")) continue;

						const data = trimmed.slice("data:".length).trim();
						if (data === "[DONE]") {
							// Pass through [DONE]
							controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
							continue;
						}

						try {
							const value = JSON.parse(data);

							// Handle finish events - send final chunk with finish_reason
							if (value.type === "finish") {
								const finishChunk = {
									id: `chatcmpl-${responseMessageId}`,
									object: "chat.completion.chunk",
									created: Math.floor(Date.now() / 1000),
									model,
									choices: [
										{
											index: 0,
											delta: {},
											finish_reason: value.finishReason || "stop",
										},
									],
								};
								controller.enqueue(
									new TextEncoder().encode(
										`data: ${JSON.stringify(finishChunk)}\n\n`,
									),
								);
								continue;
							}

							if (value.type === "text-delta" || value.type === "text") {
								// Extract text content from T3Chat format
								let textContent = "";
								if (typeof value.delta === "string") {
									textContent = value.delta;
								} else if (
									value.delta &&
									typeof value.delta === "object" &&
									typeof value.delta.text === "string"
								) {
									textContent = value.delta.text;
								} else if (typeof value.text === "string") {
									textContent = value.text;
								} else if (Array.isArray(value.content)) {
									for (const item of value.content) {
										if (item && typeof item.text === "string") {
											textContent += item.text;
										}
									}
								}

								if (textContent) {
									// Convert to OpenAI streaming format
									const openaiChunk = {
										id: `chatcmpl-${responseMessageId}`,
										object: "chat.completion.chunk",
										created: Math.floor(Date.now() / 1000),
										model,
										choices: [
											{
												index: 0,
												delta: { content: textContent },
												finish_reason: null,
											},
										],
									};
									controller.enqueue(
										new TextEncoder().encode(
											`data: ${JSON.stringify(openaiChunk)}\n\n`,
										),
									);
								}
							}
						} catch {
							// Skip invalid JSON
						}
					}
				},
			}),
		);

		return {
			response: new Response(transformedStream, {
				status: upstream.response.status,
				statusText: upstream.response.statusText,
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				},
			}),
			url: CHAT_URL,
			headers,
			transformedBody,
		};
	}
}

export const __test__ = {
	setT3ChatTransportFactory(factory) {
		transportFactory = factory;
	},
	createT3ChatTextResponse: createTextResponse,
};

export default T3ChatExecutor;
