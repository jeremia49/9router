import { randomUUID } from "node:crypto";

export function getT3ChatCredentials(credentials = {}) {
	const data = credentials.providerSpecificData || {};
	const cookies = String(data.cookies || credentials.apiKey || "").trim();
	const convexSessionId = String(
		data.convexSessionId || data.convex_session_id || "",
	).trim();

	if (!cookies || !convexSessionId) {
		throw new Error("T3Chat cookies and convexSessionId are required");
	}

	return { cookies, convexSessionId };
}

export function toT3ChatMessages(messages = []) {
	if (!Array.isArray(messages)) {
		console.error(
			"[T3CHAT-PAYLOAD-DEBUG] messages is not an array:",
			typeof messages,
		);
		return [];
	}

	if (messages.length === 0) {
		console.warn("[T3CHAT-PAYLOAD-DEBUG] Empty messages array provided");
		return [];
	}

	// T3Chat ONLY supports 'user' and 'assistant' roles
	// All other roles (system, tool, function) MUST be converted to 'user'
	// IMPORTANT: Consecutive user messages MUST be merged into a single message
	const result = [];
	let accumulatedUserContent = [];

	const flushUserMessage = () => {
		if (accumulatedUserContent.length > 0) {
			result.push({
				id: randomUUID(),
				parts: [{ type: "text", text: accumulatedUserContent.join("\n\n") }],
				role: "user",
				attachments: [],
			});
			accumulatedUserContent = [];
		}
	};

	for (const message of messages) {
		if (!message || typeof message !== "object") {
			console.error("[T3CHAT-PAYLOAD-DEBUG] Invalid message object:", message);
			continue;
		}

		const role = message.role;
		const content = message.content;

		// Skip messages with no content (except assistant which can be empty)
		if (!content && role !== "assistant") {
			console.warn(
				"[T3CHAT-PAYLOAD-DEBUG] Message with no content, role:",
				role,
			);
			continue;
		}

		// Assistant messages: flush any accumulated user content first, then add assistant
		if (role === "assistant") {
			flushUserMessage();
			result.push({
				id: randomUUID(),
				parts: [{ type: "text", text: content || "" }],
				role: "assistant",
				attachments: [],
			});
			continue;
		}

		// ALL other roles (user, system, tool, function, etc.) -> accumulate as 'user' content
		let textContent = content;

		// Add context prefix for non-user roles to preserve intent
		if (role === "system") {
			textContent = content; // No prefix for system - just merge it
		} else if (role === "tool") {
			textContent = `[Tool result: ${content}]`;
		} else if (role === "function") {
			textContent = `[Function result: ${content}]`;
		}
		// role === "user" uses content as-is

		accumulatedUserContent.push(textContent);
	}

	// Flush any remaining user content
	flushUserMessage();

	console.log(
		"[T3CHAT-PAYLOAD-DEBUG] Transformed",
		messages.length,
		"input messages to",
		result.length,
		"T3Chat messages",
	);
	if (result.length > 0) {
		console.log(
			"[T3CHAT-PAYLOAD-DEBUG] First message role:",
			result[0].role,
			"parts count:",
			result[0].parts.length,
		);
		console.log(
			"[T3CHAT-PAYLOAD-DEBUG] Last message role:",
			result[result.length - 1].role,
		);
	}

	return result;
}

export function buildT3ChatPayload({
	model,
	body,
	credentials,
	threadId,
	responseMessageId,
}) {
	const { convexSessionId } = getT3ChatCredentials(credentials);
	const reasoningEffort = body?.reasoning_effort || "medium";

	// Validate messages array
	const messages = toT3ChatMessages(body?.messages);
	if (!Array.isArray(messages) || messages.length === 0) {
		throw new Error("T3Chat requires at least one message in the request");
	}

	// Validate all messages have required structure
	for (const msg of messages) {
		if (!msg.id || !msg.role || !Array.isArray(msg.parts)) {
			throw new Error(
				"T3Chat message missing required fields (id, role, parts)",
			);
		}
	}

	return {
		messages,
		threadMetadata: { id: threadId, title: "" },
		clientAuth: { isSignedIn: true },
		responseMessageId,
		model,
		convexSessionId,
		modelParams: {
			reasoningEffort,
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
				reasoningEffort,
			},
			currentlySelectedModel: model,
			favoriteModels: [],
			hasMigrated: true,
			mainFont: "proxima",
			streamerMode: false,
			theme: "dark",
		},
		userInfo: { timezone: "America/New_York", locale: "en-US" },
		isEphemeral: false,
	};
}

export function buildT3ChatHeaders({ cookies, threadId }) {
	return {
		"Content-Type": "application/json",
		Referer: `https://t3.chat/chat/${threadId}`,
		Cookie: cookies,
		Origin: "https://t3.chat",
		Accept: "*/*",
	};
}
