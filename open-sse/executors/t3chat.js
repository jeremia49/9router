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

	async execute({
		model,
		body,
		stream,
		credentials,
		signal,
		log,
		proxyOptions = null,
	}) {
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

		// Debug: Log the full payload structure (but limit message content)
		console.log("[T3CHAT-DEBUG] Payload structure:", {
			model,
			threadId,
			responseMessageId,
			messagesCount: transformedBody.messages?.length,
			firstMessage: transformedBody.messages?.[0]
				? {
						id: transformedBody.messages[0].id,
						role: transformedBody.messages[0].role,
						partsCount: transformedBody.messages[0].parts?.length,
						textPreview:
							transformedBody.messages[0].parts?.[0]?.text?.substring(0, 100),
					}
				: null,
			modelParams: transformedBody.modelParams,
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

		// Debug: Log headers being sent (mask sensitive data)
		const debugHeaders = { ...headers };
		if (debugHeaders.Cookie) {
			debugHeaders.Cookie = `${debugHeaders.Cookie.substring(0, 50)}... (${debugHeaders.Cookie.length} chars)`;
		}
		console.log(
			"[T3CHAT-DEBUG] Request Headers:",
			JSON.stringify(debugHeaders, null, 2),
		);
		console.log("[T3CHAT-DEBUG] Request Model:", model);
		console.log(
			"[T3CHAT-DEBUG] Request Body Keys:",
			Object.keys(transformedBody),
		);

		// T3Chat always returns SSE, so we use transport.post for both streaming and non-streaming
		// The transport returns a native Response object that 9router can handle
		const upstream = await transport.post(CHAT_URL, {
			headers,
			json: transformedBody,
			signal,
			proxyOptions, // Pass proxyOptions to transport
		});

		// Debug: Log response status and partial body
		console.log("[T3CHAT-DEBUG] Response Status:", upstream.status);
		if (upstream.text) {
			const preview = upstream.text.substring(0, 500);
			console.log("[T3CHAT-DEBUG] Response Body Preview:", preview);
		}

		if (upstream.status === 401 || upstream.status === 403) {
			const errorDetail = upstream.text
				? `Response: ${upstream.text.substring(0, 200)}`
				: "No response body";
			console.error("[T3CHAT-DEBUG] Auth Error:", errorDetail);
			throw new Error(
				"T3Chat rejected the provided session. Refresh cookies and convexSessionId. " +
					errorDetail,
			);
		}
		if (upstream.status === 429) {
			const errorDetail = upstream.text
				? `Response: ${upstream.text.substring(0, 500)}`
				: "No response body";

			// Check if this is Vercel Security Checkpoint (HTML response)
			const isVercelCheckpoint =
				upstream.text &&
				(upstream.text.includes("Vercel Security Checkpoint") ||
					upstream.text.includes("vercel-security") ||
					upstream.text.includes("data-astro-cid"));

			console.error("[T3CHAT-DEBUG] Rate Limit/Fingerprint Rejection:");

			if (isVercelCheckpoint) {
				console.error(
					"[T3CHAT-DEBUG] *** VERCEL SECURITY CHECKPOINT DETECTED ***",
				);
				console.error(
					"[T3CHAT-DEBUG] This is NOT T3Chat blocking you - it's Vercel's bot protection!",
				);
				console.error("[T3CHAT-DEBUG]");
				console.error("[T3CHAT-DEBUG] Why this happens:");
				console.error("[T3CHAT-DEBUG]   - T3Chat is hosted on Vercel");
				console.error(
					"[T3CHAT-DEBUG]   - Vercel detects your server IP as datacenter/VPS",
				);
				console.error(
					"[T3CHAT-DEBUG]   - Vercel blocks non-residential IPs even with correct browser fingerprints",
				);
				console.error("[T3CHAT-DEBUG]");
				console.error("[T3CHAT-DEBUG] SOLUTIONS:");
				console.error(
					"[T3CHAT-DEBUG]   1. Use a residential proxy (RECOMMENDED)",
				);
				console.error(
					"[T3CHAT-DEBUG]      export T3CHAT_PROXY=http://residential-proxy:port",
				);
				console.error(
					"[T3CHAT-DEBUG]   2. Use SSH tunnel from local machine (temporary)",
				);
				console.error(
					"[T3CHAT-DEBUG]      ssh -R 20127:localhost:20127 user@server",
				);
				console.error("[T3CHAT-DEBUG]   3. Deploy to residential IP/VPS");
				console.error("[T3CHAT-DEBUG]");
				console.error(
					"[T3CHAT-DEBUG] See VERCEL_SECURITY_CHECKPOINT_FIX.md for details",
				);

				throw new Error(
					"Vercel Security Checkpoint blocked the request. " +
						"Your server IP is detected as datacenter/bot. " +
						"Use a residential proxy or SSH tunnel. " +
						"See VERCEL_SECURITY_CHECKPOINT_FIX.md for solutions.",
				);
			} else {
				console.error("[T3CHAT-DEBUG] - This usually means:");
				console.error(
					"[T3CHAT-DEBUG]   1. Browser fingerprint not recognized (wreq-js issue)",
				);
				console.error("[T3CHAT-DEBUG]   2. IP address blocked/suspicious");
				console.error("[T3CHAT-DEBUG]   3. Cookies expired or invalid");
				console.error("[T3CHAT-DEBUG]   4. Rate limit exceeded");
			}

			console.error("[T3CHAT-DEBUG] Error Detail:", errorDetail);
			throw new Error(
				"T3Chat returned HTTP 429. This can mean rate limiting or browser-fingerprint rejection; retry later and refresh credentials if it persists. " +
					errorDetail,
			);
		}
		if (upstream.status >= 400) {
			// Error text already read by transport
			const errorText = upstream.text || "";

			// Try to parse error JSON for better error messages
			let errorMessage = `T3Chat returned HTTP ${upstream.status}.`;
			try {
				const errorJson = JSON.parse(errorText);
				if (errorJson.error) {
					errorMessage += ` Error type: ${errorJson.error.type || "unknown"}, Message: ${errorJson.error.message || "No message"}`;

					// Provide specific guidance based on error type
					if (errorJson.error.type === "invalid_params") {
						errorMessage +=
							" - Check that your request payload matches T3Chat's expected format. ";
						errorMessage +=
							"This usually means: missing required fields, invalid message structure, or unsupported model parameters.";
					}
					if (errorJson.error.type === "unknown") {
						errorMessage += " - This is a server-side error from T3Chat. ";
						errorMessage +=
							"Try again in a moment. If it persists, check your cookies/convexSessionId are valid.";
					}
				}
			} catch (e) {
				// Not JSON, append raw error text
				if (errorText) {
					errorMessage += ` Response: ${errorText.substring(0, 300)}`;
				}
			}

			console.error("[T3CHAT-DEBUG] Error Details:", errorMessage);
			throw new Error(errorMessage);
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
