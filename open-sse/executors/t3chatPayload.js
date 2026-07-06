import { randomUUID } from "node:crypto";
import { ToolRegistry } from "./t3chatTools.js";

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

export function toT3ChatMessages(messages = [], systemPrompt = null) {
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

	// Add system prompt at the beginning if provided
	if (systemPrompt) {
		accumulatedUserContent.push(systemPrompt);
	}

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
		const toolCalls = message.tool_calls;

		// Skip system messages - already handled by systemPrompt parameter
		if (role === "system") {
			continue;
		}

		// Skip messages with no content (except assistant which can be empty or have tool_calls)
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

			// Convert tool_calls back to text blocks for t3chat
			let assistantContent = content || "";
			if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
				const blocks = [];
				for (const tc of toolCalls) {
					const fnName = tc.function?.name ?? "";
					const argsStr = tc.function?.arguments ?? "";
					let argsDict = {};
					try {
						argsDict = argsStr ? JSON.parse(argsStr) : {};
					} catch {}
					const params = Object.entries(argsDict)
						.map(([k, v]) =>
							typeof v === "string" ? `${k}="${v}"` : `${k}=${v}`,
						)
						.join(" ");
					blocks.push(
						params
							? `\`\`\`tool:${fnName} ${params}\n\`\`\``
							: `\`\`\`tool:${fnName}\n\`\`\``,
					);
				}
				if (blocks.length > 0) {
					const joinedBlocks = blocks.join("\n");
					assistantContent = assistantContent
						? `${assistantContent}\n${joinedBlocks}`
						: joinedBlocks;
				}
			}

			result.push({
				id: randomUUID(),
				parts: [{ type: "text", text: assistantContent }],
				role: "assistant",
				attachments: [],
			});
			continue;
		}

		// ALL other roles (user, tool, function, etc.) -> accumulate as 'user' content
		let textContent = content;

		// Add context prefix for non-user roles to preserve intent
		if (role === "tool") {
			const toolName = message.name ?? message.tool_call_id ?? "tool";
			textContent = `[Tool result: ${toolName}]\n${content || "[tool returned no output]"}`;
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

	// Build system prompt with tools if provided
	let systemPrompt = null;
	const tools = body?.tools;
	if (tools && Array.isArray(tools) && tools.length > 0) {
		const registry = new ToolRegistry(tools);
		const toolPrompt = registry.toPrompt();
		if (toolPrompt) {
			systemPrompt = toolPrompt;
			console.log(
				"[T3CHAT-PAYLOAD-DEBUG] Injected tool prompt:",
				toolPrompt.length,
				"chars",
			);
		}
	}

	// Validate messages array
	const messages = toT3ChatMessages(body?.messages, systemPrompt);
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
