import { describe, expect, it } from "vitest";

import { parseT3ChatTextResponse } from "../../open-sse/executors/t3chatParser.js";
import {
	buildT3ChatHeaders,
	buildT3ChatPayload,
	getT3ChatCredentials,
} from "../../open-sse/executors/t3chatPayload.js";

describe("T3Chat text parser", () => {
	it("parses supported text event shapes", () => {
		const body = [
			'data: {"type":"text-delta","delta":"Hel"}',
			'data: {"type":"text-delta","delta":{"text":"lo"}}',
			'data: {"type":"text","text":" "}',
			'data: {"type":"text","content":[{"text":"world"}]}',
			"data: [DONE]",
			'data: {"type":"text","text":"ignored"}',
		].join("\n");

		expect(parseT3ChatTextResponse(body)).toBe("Hello world");
	});

	it("throws when no parseable text exists", () => {
		expect(() =>
			parseT3ChatTextResponse('data: {"type":"metadata"}\n'),
		).toThrow("T3Chat returned no parseable text content");
	});
});

describe("T3Chat payload helpers", () => {
	const credentials = {
		providerSpecificData: {
			cookies: " wos-session=abc; other=def ",
			convexSessionId: " convex-123 ",
		},
	};

	it("extracts and validates credentials", () => {
		expect(getT3ChatCredentials(credentials)).toEqual({
			cookies: "wos-session=abc; other=def",
			convexSessionId: "convex-123",
		});
		expect(() =>
			getT3ChatCredentials({ providerSpecificData: { cookies: "" } }),
		).toThrow("T3Chat cookies and convexSessionId are required");
	});

	it("merges system messages into user messages", () => {
		const messages = [
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi there!" },
		];
		const result = buildT3ChatPayload({
			model: "gpt-4o",
			body: { messages },
			credentials,
			threadId: "thread-1",
			responseMessageId: "response-1",
		}).messages;

		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({
			role: "user",
			parts: [{ type: "text", text: "You are a helpful assistant.\n\nHello" }],
			attachments: [],
		});
		expect(result[0].id).toBeTruthy();
		expect(result[1]).toMatchObject({
			role: "assistant",
			parts: [{ type: "text", text: "Hi there!" }],
			attachments: [],
		});
		expect(result[1].id).toBeTruthy();
	});

	it("converts tool messages to user messages", () => {
		const messages = [
			{ role: "user", content: "What's the weather?" },
			{ role: "assistant", content: "Let me check." },
			{ role: "tool", content: "Temperature: 72°F" },
		];
		const result = buildT3ChatPayload({
			model: "gpt-4o",
			body: { messages },
			credentials,
			threadId: "thread-1",
			responseMessageId: "response-1",
		}).messages;

		expect(result).toHaveLength(3);
		expect(result[2]).toMatchObject({
			role: "user",
			parts: [{ type: "text", text: "[Tool result: Temperature: 72°F]" }],
			attachments: [],
		});
		expect(result[2].id).toBeTruthy();
	});

	it("builds headers", () => {
		expect(
			buildT3ChatHeaders({ cookies: "c=1", threadId: "thread-1" }),
		).toEqual({
			"Content-Type": "application/json",
			Referer: "https://t3.chat/chat/thread-1",
			Cookie: "c=1",
			Origin: "https://t3.chat",
			Accept: "*/*",
		});
	});

	it("builds payload with T3Chat required fields", () => {
		const payload = buildT3ChatPayload({
			model: "gpt-4o-mini",
			body: { messages: [{ role: "user", content: "hi" }] },
			credentials,
			threadId: "thread-1",
			responseMessageId: "response-1",
		});

		expect(payload).toMatchObject({
			threadMetadata: { id: "thread-1", title: "" },
			clientAuth: { isSignedIn: true },
			responseMessageId: "response-1",
			model: "gpt-4o-mini",
			convexSessionId: "convex-123",
			modelParams: {
				reasoningEffort: "medium",
				includeSearch: false,
				searchLimit: 1,
			},
			preferences: {
				name: "",
				occupation: "",
				selectedTraits: [],
				additionalInfo: "",
			},
			userConfiguration: {
				codeFont: "berkeley",
				currentModelParameters: {
					includeSearch: false,
					reasoningEffort: "medium",
				},
				currentlySelectedModel: "gpt-4o-mini",
				favoriteModels: [],
				hasMigrated: true,
				mainFont: "proxima",
				streamerMode: false,
				theme: "dark",
			},
			userInfo: { timezone: "America/New_York", locale: "en-US" },
			isEphemeral: false,
		});

		// Check message format
		expect(payload.messages).toHaveLength(1);
		expect(payload.messages[0]).toMatchObject({
			role: "user",
			parts: [{ type: "text", text: "hi" }],
			attachments: [],
		});
		expect(payload.messages[0].id).toBeTruthy();
	});
});
