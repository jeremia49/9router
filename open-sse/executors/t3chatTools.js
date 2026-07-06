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
			"The host has provided REAL tools in this request. You do not execute actions directly in prose; you request them by emitting `tool:` fenced blocks.",
			"",
			"TOOL CALL PROTOCOL:",
			"Emit one or more fenced blocks and then stop so the host can run them:",
			"",
			"```tool:<exact_tool_name>",
			'{"argument_name":"argument value"}',
			"```",
			"",
			"You may also put simple scalar arguments on the opening line as key=value, but JSON in the block body is preferred for accuracy.",
			"Use only the exact tool names listed below. The proxy converts each block to OpenAI `tool_calls` for the client.",
			"",
			"AVAILABLE TOOLS:",
		];

		for (const spec of this.specs.values()) {
			const properties = this.getProperties(spec);
			const required = this.getRequired(spec);
			const requiredNames = Object.keys(properties).filter((name) =>
				required.has(name),
			);
			const optionalNames = Object.keys(properties).filter(
				(name) => !required.has(name),
			);
			const desc = this.shorten(spec.description, 160);
			const details = [];
			if (desc) details.push(desc);
			if (requiredNames.length > 0)
				details.push("required: " + requiredNames.join(", "));
			if (optionalNames.length > 0) {
				details.push("optional: " + optionalNames.slice(0, 16).join(", "));
				if (optionalNames.length > 16)
					details.push(`+${optionalNames.length - 16} more optional args`);
			}
			lines.push(
				`- ${spec.name}` +
					(details.length > 0 ? `: ${details.join("; ")}` : ""),
			);
		}

		lines.push(
			"",
			"RULES:",
			"1. If the user asks for information that requires any listed tool, call the relevant tool instead of explaining that you cannot.",
			"2. Do not ask the user to run commands, open files, paste file contents, or perform work that a listed tool can do.",
			"3. When you need tool results before answering, emit only tool blocks and no prose.",
			"4. After tool results arrive, continue from those results. Call more tools if needed; otherwise give the final answer.",
			"5. If a tool can access files, terminals, browsers, web search, calendars, or other external systems, treat that access as available through the host tool.",
		);

		return lines.join("\n");
	}

	getRequired(spec) {
		const rawRequired = spec.parameters?.required;
		if (!Array.isArray(rawRequired)) return new Set();
		return new Set(rawRequired.map((item) => String(item)));
	}

	getProperties(spec) {
		const rawProperties = spec.parameters?.properties;
		return rawProperties && typeof rawProperties === "object"
			? rawProperties
			: {};
	}

	shorten(value, limit) {
		const text = String(value ?? "")
			.split(/\s+/)
			.join(" ");
		if (text.length <= limit) return text;
		return text.slice(0, Math.max(0, limit - 3)).trimEnd() + "...";
	}

	coerce(rawTool) {
		const func = rawTool.function ?? rawTool;
		const name = String(func?.name ?? "").trim();
		if (!name) return null;
		const params = func?.parameters ?? {};
		return {
			name,
			description: String(func?.description ?? ""),
			parameters: params && typeof params === "object" ? params : {},
		};
	}
}

export class ToolCallTranslator {
	constructor(registry) {
		this.registry = registry;
	}

	fromTextBlocks(text) {
		const calls = parseToolCalls(text);
		return calls.map((call) => this.toOpenAIToolCall(call));
	}

	toOpenAIToolCall(call) {
		const name = this.registry.resolveName(call.name);
		const spec = this.registry.get(name);
		const arguments_ = this.argumentsFor(call, spec);
		return {
			id: `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
			name,
			arguments: JSON.stringify(arguments_),
		};
	}

	argumentsFor(call, spec) {
		const args = { ...call.params };
		const body = call.body.trim();
		if (!body) return args;

		const parsedBody = this.jsonLoadsObject(body);
		if (parsedBody) {
			Object.assign(args, parsedBody);
			return args;
		}

		if (spec) {
			const target = this.singleBodyProperty(spec);
			if (target && !(target in args)) {
				args[target] = body;
				return args;
			}
		}

		if (!("body" in args)) args.body = body;
		return args;
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

export function stripToolBlocks(text) {
	if (!text) return "";
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

	add(rawCalls) {
		for (let position = 0; position < rawCalls.length; position++) {
			const rawCall = rawCalls[position];
			if (!rawCall || typeof rawCall !== "object") continue;
			const index = Number(rawCall.index ?? position) || 0;
			const current = this.byIndex.get(index) ?? { arguments: "" };
			this.byIndex.set(index, current);

			const callId = rawCall.id;
			if (callId) current.id = callId;
			const callType = rawCall.type;
			if (callType) current.type = callType;

			const fn = rawCall.function;
			if (fn && typeof fn === "object") {
				const name = fn.name;
				if (name) current.name = name;
				if ("arguments" in fn) {
					current.arguments =
						String(current.arguments ?? "") + String(fn.arguments ?? "");
				}
				continue;
			}

			if (rawCall.name) current.name = rawCall.name;
			if ("arguments" in rawCall) {
				current.arguments =
					String(current.arguments ?? "") + String(rawCall.arguments ?? "");
			}
		}
	}

	snapshot() {
		const out = [];
		const indices = [...this.byIndex.keys()].sort((a, b) => a - b);
		for (const index of indices) {
			const item = this.byIndex.get(index);
			const name = String(item.name ?? "");
			if (!name) continue;
			out.push({
				id: item.id ?? `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
				name,
				arguments: String(item.arguments ?? "{}") || "{}",
			});
		}
		return out;
	}
}
