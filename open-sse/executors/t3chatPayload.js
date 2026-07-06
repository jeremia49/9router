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
	if (!Array.isArray(messages)) return [];

	// T3Chat doesn't support system or tool roles, so we merge them into user messages
	const result = [];
	let pendingSystemContent = [];

	for (const message of messages) {
		const role = message.role;
		const content = message.content;

		// System messages: accumulate and prepend to next user message
		if (role === "system") {
			pendingSystemContent.push(content);
			continue;
		}

		// Tool/function messages: convert to user messages
		if (role === "tool" || role === "function") {
			result.push({
				id: randomUUID(),
				parts: [{ type: "text", text: `[Tool result: ${content}]` }],
				role: "user",
				attachments: [],
			});
			continue;
		}

		// User messages: prepend any pending system content
		if (role === "user") {
			let finalContent = content;
			if (pendingSystemContent.length > 0) {
				finalContent = pendingSystemContent.join("\n\n") + "\n\n" + content;
				pendingSystemContent = [];
			}
			result.push({
				id: randomUUID(),
				parts: [{ type: "text", text: finalContent }],
				role: "user",
				attachments: [],
			});
			continue;
		}

		// Assistant messages: pass through
		if (role === "assistant") {
			result.push({
				id: randomUUID(),
				parts: [{ type: "text", text: content }],
				role: "assistant",
				attachments: [],
			});
			continue;
		}

		// Unknown role: convert to user message
		result.push({
			id: randomUUID(),
			parts: [{ type: "text", text: String(content || "") }],
			role: "user",
			attachments: [],
		});
	}

	// If there are pending system messages at the end, prepend them to a new user message
	if (pendingSystemContent.length > 0) {
		result.push({
			id: randomUUID(),
			parts: [{ type: "text", text: pendingSystemContent.join("\n\n") }],
			role: "user",
			attachments: [],
		});
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

	return {
		messages: toT3ChatMessages(body?.messages),
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
