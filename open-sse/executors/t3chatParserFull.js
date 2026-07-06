/**
 * Full parser for T3Chat SSE responses
 * Parses text, reasoning, tool calls, and other events
 */

function pushText(value, parts) {
	if (typeof value?.delta === "string") {
		parts.push(value.delta);
		return;
	}
	if (
		value?.delta &&
		typeof value.delta === "object" &&
		typeof value.delta.text === "string"
	) {
		parts.push(value.delta.text);
		return;
	}
	if (typeof value?.text === "string") {
		parts.push(value.text);
		return;
	}
	if (Array.isArray(value?.content)) {
		for (const item of value.content) {
			if (typeof item?.text === "string") {
				parts.push(item.text);
			}
		}
	}
}

export function parseT3ChatTextResponse(body) {
	const parts = [];
	for (const line of String(body || "").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("data:")) continue;
		const data = trimmed.slice("data:".length).trim();
		if (data === "[DONE]") break;

		let value;
		try {
			value = JSON.parse(data);
		} catch {
			continue;
		}

		if (value?.type === "text-delta" || value?.type === "text") {
			pushText(value, parts);
		}
	}

	const text = parts.join("").trim();
	if (!text) {
		throw new Error("T3Chat returned no parseable text content");
	}
	return text;
}

/**
 * Parse full T3Chat SSE response including text, reasoning, tool calls
 * Returns { text, reasoning, toolCalls, finishReason }
 */
export function parseT3ChatFullResponse(body) {
	const textParts = [];
	const reasoningParts = [];
	const toolCalls = [];
	let currentToolCall = null;
	let finishReason = "stop";

	for (const line of String(body || "").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("data:")) continue;
		const data = trimmed.slice("data:".length).trim();
		if (data === "[DONE]") break;

		let value;
		try {
			value = JSON.parse(data);
		} catch {
			continue;
		}

		// Parse text deltas
		if (value?.type === "text-delta" || value?.type === "text") {
			pushText(value, textParts);
			continue;
		}

		// Parse reasoning deltas
		if (value?.type === "reasoning-delta") {
			const reasoningText = value.text || value.delta || "";
			if (reasoningText) {
				reasoningParts.push(reasoningText);
			}
			continue;
		}

		// Parse tool call start
		if (value?.type === "tool-input-start") {
			currentToolCall = {
				id: value.id || "",
				name: value.name || "",
				arguments: "",
			};
			toolCalls.push(currentToolCall);
			continue;
		}

		// Parse tool call arguments
		if (value?.type === "tool-input-available") {
			if (currentToolCall) {
				currentToolCall.arguments += value.input || "";
			}
			continue;
		}

		// Parse finish event
		if (value?.type === "finish") {
			finishReason = value.finishReason || value.reason || "stop";
			continue;
		}
	}

	const text = textParts.join("").trim();
	const reasoning = reasoningParts.join("").trim();

	// If we have tool calls but finish reason is still "stop", change it to "tool_calls"
	if (toolCalls.length > 0 && finishReason === "stop") {
		finishReason = "tool_calls";
	}

	return {
		text,
		reasoning,
		toolCalls,
		finishReason,
	};
}

export const __test__ = { pushText };
