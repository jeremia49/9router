import { randomUUID } from "node:crypto";

/**
 * Tool calling support for t3chat in 9router
 *
 * Implements text-based tool calling protocol:
 * 1. Inject tool definitions into system prompt
 * 2. Model emits `tool:<name>` fenced blocks
 * 3. Parse blocks and convert to OpenAI tool_calls format
 * 4. Support native tool_calls from SSE stream
 */

const TOOL_CALL_RE = /```tool:([A-Za-z0-9_.:-]+)([^\n`]*)\r?\n([\s\S]*?)```/gi;
const PARAM_RE =
	/([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;

export class ToolRegistry {
	constructor(tools) {
		this.specs = new Map();
		if (!tools) return;

		for (const rawTool of tools) {
			const spec = this.coerce(rawTool);
			if (spec) this.specs.set(spec.name, spec);
		}
	}

	get size() {
		return this.specs.size;
	}
	get names() {
		return [...this.specs.keys()];
	}
	get(name) {
		return this.specs.get(name);
	}

	resolveName(name) {
		if (this.specs.has(name)) return name;
		const lowered = name.toLowerCase();
		for (const candidate of this.specs.keys()) {
			if (candidate.toLowerCase() === lowered) return candidate;
		}
		return name;
	}

	toPrompt() {
		if (this.specs.size === 0) return "";

		const lines = [
			"You are running inside a host application that will execute OpenAI function tools for you.",
			"The host requires you to emit tool calls as fenced code blocks with this format:",
			"",
			"```tool:<exact_tool_name>",
			'{"parameter": "value"}',
			"```",
			"",
			"Rules:",
			"1. Use the EXACT tool name from the list below (case-sensitive)",
			"2. Include valid JSON arguments on the line after the tool name",
			"3. Close the block with ``` on its own line",
			"4. When you emit a tool block, STOP your response there - do not continue writing",
			"5. The host will execute the tool and return results in the next message",
			"",
			"Available tools:",
			"",
		];

		for (const spec of this.specs.values()) {
			lines.push(`## ${spec.name}`);
			if (spec.description) lines.push(spec.description);

			const properties = this.getProperties(spec);
			const required = this.getRequired(spec);

			if (Object.keys(properties).length > 0) {
				lines.push("");
				lines.push("Parameters:");
				for (const [key, schema] of Object.entries(properties)) {
					const reqMark = required.has(key) ? " (required)" : "";
					const desc = schema?.description || "";
					lines.push(`- ${key}${reqMark}: ${desc}`);
				}
			}
			lines.push("");
		}

		return lines.join("\n");
	}

	getProperties(spec) {
		if (!spec || typeof spec !== "object") return {};
		const params = spec.parameters;
		if (!params || typeof params !== "object") return {};
		return params.properties ?? {};
	}

	getRequired(spec) {
		if (!spec || typeof spec !== "object") return new Set();
		const params = spec.parameters;
		if (!params || typeof params !== "object") return new Set();
		const req = params.required;
		return new Set(Array.isArray(req) ? req : []);
	}

	coerce(rawTool) {
		if (!rawTool || typeof rawTool !== "object") return null;
		if (rawTool.type === "function" && rawTool.function) {
			const fn = rawTool.function;
			return {
				name: String(fn.name ?? ""),
				description: String(fn.description ?? ""),
				parameters: fn.parameters ?? {},
			};
		}
		if (rawTool.name) {
			return {
				name: String(rawTool.name),
				description: String(rawTool.description ?? ""),
				parameters: rawTool.parameters ?? {},
			};
		}
		return null;
	}
}

export class ToolCallTranslator {
	constructor(registry) {
		this.registry = registry;
	}

	assistantMessageToT3Chat(message) {
		if (!message || typeof message !== "object") return null;
		if (message.role !== "assistant") return null;

		const parts = [];

		if (message.content) {
			parts.push({ type: "text", text: String(message.content) });
		}

		const toolCalls = message.tool_calls;
		if (Array.isArray(toolCalls) && toolCalls.length > 0) {
			for (const tc of toolCalls) {
				if (!tc || typeof tc !== "object") continue;
				const fn = tc.function;
				if (!fn || typeof fn !== "object") continue;

				const name = String(fn.name ?? "");
				const args = String(fn.arguments ?? "{}");

				const toolBlock = `\`\`\`tool:${name}\n${args}\n\`\`\``;
				parts.push({ type: "text", text: toolBlock });
			}
		}

		if (parts.length === 0) return null;

		return {
			id: randomUUID(),
			role: "assistant",
			parts,
		};
	}

	toolMessageToT3Chat(message) {
		if (!message || typeof message !== "object") return null;
		if (message.role !== "tool") return null;

		const name = String(message.name ?? message.tool_call_id ?? "unknown");
		const content = String(message.content ?? "");

		const text = `[Tool result: ${name}]\n${content}`;

		return {
			id: randomUUID(),
			role: "user",
			parts: [{ type: "text", text }],
		};
	}

	singleBodyProperty(spec) {
		const properties = this.registry.getProperties(spec);
		const required = this.registry.getRequired(spec);

		const stringProps = Object.entries(properties)
			.filter(([, schema]) => {
				if (!schema || typeof schema !== "object") return false;
				const type = String(schema.type ?? "string").toLowerCase();
				return type === "string" || type === "any";
			})
			.map(([name]) => name);

		const requiredStringProps = stringProps.filter((name) =>
			required.has(name),
		);
		if (requiredStringProps.length === 1) return requiredStringProps[0];
		if (stringProps.length === 1) return stringProps[0];
		return "body" in properties ? "body" : null;
	}

	jsonLoadsObject(value) {
		try {
			const parsed = JSON.parse(value);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? parsed
				: null;
		} catch {
			return null;
		}
	}
}

export class ToolRefusalDetector {
	constructor() {
		this.refusalRe =
			/\b(can't|cannot|can not|don't have|do not have|unable to|not able to|no access|without access|can't actually|cannot actually)\b/i;
		this.capabilityRe =
			/\b(tool|terminal|shell|command|run|execute|file|filesystem|browse|browser|web search|search|calendar|schedule|environment)\b/i;
	}

	looksLikeFalseRefusal(text) {
		if (!text || text.length > 2500) return false;
		return this.refusalRe.test(text) && this.capabilityRe.test(text);
	}
}

export function parseParams(paramStr) {
	if (!paramStr) return {};
	const result = {};
	let m;
	PARAM_RE.lastIndex = 0;
	while ((m = PARAM_RE.exec(paramStr)) !== null) {
		const key = m[1];
		const value = m[2] ?? m[3] ?? m[4];
		result[key] = value;
	}
	return result;
}

export function parseToolCalls(text) {
	if (!text) return [];
	const out = [];
	let safety = 0;
	let m;
	TOOL_CALL_RE.lastIndex = 0;
	while ((m = TOOL_CALL_RE.exec(text)) !== null) {
		safety++;
		if (safety > 50) break;
		const name = m[1].toLowerCase();
		const params = parseParams(m[2].trim());
		const body = m[3].replace(/^\r?\n|\r?\n$/g, "");
		out.push({ name, params, body, raw: m[0] });
	}
	return out;
}

/**
 * Post-process response text to extract tool calls in OpenAI format
 * IMPROVED: Strict validation, reject invalid calls, better error messages
 */
export function postProcessToolCalls(text, registry = null) {
	if (!text || typeof text !== "string") {
		return { content: text || "" };
	}

	// Parse tool calls from text
	const parsedCalls = parseToolCalls(text);
	if (parsedCalls.length === 0) {
		return { content: text };
	}

	// Convert to OpenAI tool_calls format
	const toolCalls = [];
	const invalidCalls = [];
	
	for (const call of parsedCalls) {
		let argumentsJson = null;
		
		// Try to parse body as JSON first
		if (call.body && call.body.trim().startsWith("{")) {
			try {
				// Validate JSON strictly
				const parsed = JSON.parse(call.body.trim());
				
				// Reject empty objects
				if (Object.keys(parsed).length === 0) {
					console.warn(`[T3CHAT-TOOLS] Rejected tool call '${call.name}' with empty arguments {}`);
					invalidCalls.push({ name: call.name, reason: "empty_arguments" });
					continue;
				}
				
				// Validate that parsed object doesn't look like HTML attributes
				const keys = Object.keys(parsed);
				const htmlAttrPattern = /^(class|id|style|charset|content|name|type|rel|href|src)$/i;
				const suspiciousKeys = keys.filter(k => htmlAttrPattern.test(k));
				
				if (suspiciousKeys.length > 3) {
					console.warn(`[T3CHAT-TOOLS] Rejected tool call '${call.name}' - looks like misparsed HTML attributes:`, keys);
					invalidCalls.push({ name: call.name, reason: "html_attributes_detected", keys });
					continue;
				}
				
				argumentsJson = call.body.trim();
			} catch (err) {
				console.warn(`[T3CHAT-TOOLS] JSON parse failed for tool '${call.name}':`, err.message);
				console.warn(`[T3CHAT-TOOLS] Body preview:`, call.body.substring(0, 200));
				
				// If body is not valid JSON, try params
				if (call.params && Object.keys(call.params).length > 0) {
					argumentsJson = JSON.stringify(call.params);
				} else {
					invalidCalls.push({ name: call.name, reason: "invalid_json", error: err.message });
					continue;
				}
			}
		} else if (call.params && Object.keys(call.params).length > 0) {
			// Use params if body is not JSON
			argumentsJson = JSON.stringify(call.params);
		} else if (call.body && call.body.trim().length > 0) {
			// Wrap plain text body in a generic parameter
			argumentsJson = JSON.stringify({ input: call.body.trim() });
		} else {
			// No valid arguments
			console.warn(`[T3CHAT-TOOLS] Rejected tool call '${call.name}' - no valid arguments`);
			invalidCalls.push({ name: call.name, reason: "no_arguments" });
			continue;
		}

		// Resolve tool name if registry is provided
		let toolName = call.name;
		if (registry && typeof registry.resolveName === "function") {
			toolName = registry.resolveName(call.name);
		}

		// Generate unique call ID (similar to Python's hash approach)
		const callId = `call_${hashString(argumentsJson) % 100000000}`;

		toolCalls.push({
			id: callId,
			type: "function",
			function: {
				name: toolName,
				arguments: argumentsJson,
			},
		});
	}
	
	// Log summary
	if (invalidCalls.length > 0) {
		console.warn(`[T3CHAT-TOOLS] Rejected ${invalidCalls.length} invalid tool call(s):`, invalidCalls);
	}
	
	if (toolCalls.length === 0) {
		console.warn(`[T3CHAT-TOOLS] No valid tool calls found after parsing`);
		return { content: text };
	}

	// Strip tool blocks from text to get remaining content
	const remainingText = stripToolBlocks(text);

	return {
		tool_calls: toolCalls,
		content: remainingText || "",
	};
}

/**
 * Simple string hash function for generating call IDs
 */
function hashString(str) {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return Math.abs(hash);
}

export function stripToolBlocks(text) {
	if (!text) return "";
	// Reset regex lastIndex before use
	TOOL_CALL_RE.lastIndex = 0;
	return text.replace(TOOL_CALL_RE, "").trim();
}

export function toolsToUserReminder(tools) {
	const registry = new ToolRegistry(tools);
	if (registry.size === 0) return "";
	const names = registry.names.join(", ");
	return (
		`\n\n[Tool access reminder: this request includes executable host tools. ` +
		`When a listed tool can satisfy the request, emit a \`tool:<exact_tool_name>\` ` +
		`fenced block and stop for results. Available tool names: ${names}]`
	);
}

export function toolCorrectionPrompt(registry) {
	const names = registry.names.join(", ");
	return (
		"[SYSTEM TOOL CORRECTION]\n" +
		"Your previous answer said or implied that a host capability was unavailable, " +
		"but this request includes executable OpenAI tools. Re-evaluate the user's " +
		"request against the provided tool schemas. If any listed tool can perform " +
		`the needed external action, emit the correct \`tool:\` fenced block now using ` +
		`one exact tool name from this list: ${names}. Do not ask the user to run the ` +
		"tool manually. If no provided tool is relevant after checking the schemas, " +
		"answer normally and briefly."
	);
}

export function normalizeStreamedToolCalls(toolCalls, clientTools) {
	const registry = new ToolRegistry(clientTools);
	const normalized = [];
	for (const tc of toolCalls) {
		if (!tc || typeof tc !== "object") continue;
		const fn = tc.function;
		let name;
		let arguments_;
		if (fn && typeof fn === "object") {
			name = String(fn.name ?? "");
			arguments_ = String(fn.arguments ?? "{}") || "{}";
		} else {
			name = String(tc.name ?? "");
			arguments_ = String(tc.arguments ?? "{}") || "{}";
		}
		normalized.push({
			id: tc.id ?? `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
			name: registry.resolveName(name),
			arguments: arguments_,
		});
	}
	return normalized;
}

export class ToolCallDeltaAccumulator {
	constructor() {
		this.byIndex = new Map();
	}

	addDelta(delta) {
		if (!delta || !Array.isArray(delta.tool_calls)) return;
		for (const tc of delta.tool_calls) {
			if (typeof tc.index !== "number") continue;
			const idx = tc.index;
			if (!this.byIndex.has(idx)) {
				this.byIndex.set(idx, { id: "", name: "", arguments: "" });
			}
			const acc = this.byIndex.get(idx);
			if (tc.id) acc.id = tc.id;
			if (tc.function?.name) acc.name += tc.function.name;
			if (tc.function?.arguments) acc.arguments += tc.function.arguments;
		}
	}

	getSnapshot() {
		return [...this.byIndex.values()];
	}

	reset() {
		this.byIndex.clear();
	}
}
