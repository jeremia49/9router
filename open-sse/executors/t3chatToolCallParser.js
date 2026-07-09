// t3chatToolCallParser.js
// Universal tool-call parser -> OpenAI tool_call JSON schema, for the t3chat
// provider. t3chat has no native function-calling wire protocol: the model is
// asked to *emit* tool calls as text, and this module converts that text back
// into the OpenAI `tool_calls` shape (both batch and streaming).
//
// Ported from t3chatparser/toolCallParser.mjs and extended with the legacy
// ```tool:<name>``` fenced dialect so existing prompts and serialized
// conversation history keep round-tripping.
//
// Supported input dialects (mixed with free narration text):
//   A. XML-like:   <invoke name="X"><parameter name="Y">...</parameter></invoke>
//   B. tool fence: ```tool:X key="v"\n{ ...json... }```  (legacy t3chat format)
//   C. Fenced:     ```json { ... } ```
//   D. Loose JSON: {"name":"X","arguments":{...}}  or  {"tool":"X","parameters":{...}}
//
// Output (OpenAI convention). NOTE: `function.arguments` is a JSON *string*.
//   { id, type:"function", function:{ name, arguments } }

let __counter = 0;
function genId() {
	__counter += 1;
	const rand = Math.random().toString(36).slice(2, 10);
	return `call_${Date.now().toString(36)}${rand}${__counter}`;
}

// ---------------------------------------------------------------------------
// Value coercion: try to interpret a raw param string as JSON, else keep string.
// ---------------------------------------------------------------------------
function coerceValue(raw) {
	if (typeof raw !== "string") return raw;
	const trimmed = raw.trim();
	if (trimmed === "") return raw; // preserve empty/whitespace as-is
	const first = trimmed[0];
	const looksJson =
		first === "{" ||
		first === "[" ||
		first === '"' ||
		trimmed === "true" ||
		trimmed === "false" ||
		trimmed === "null" ||
		/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed);
	if (looksJson) {
		try {
			return JSON.parse(trimmed);
		} catch {
			return raw;
		}
	}
	return raw;
}

// ---------------------------------------------------------------------------
// Normalize an extracted { name, args } into the OpenAI tool_call schema.
// ---------------------------------------------------------------------------
function toOpenAI(name, argsObj, id = genId()) {
	return {
		id,
		type: "function",
		function: {
			name,
			arguments: JSON.stringify(argsObj ?? {}),
		},
	};
}

// ---------------------------------------------------------------------------
// Dialect A: XML-like <invoke>/<parameter> extraction.
// Param bodies are captured literally (never parsed as XML), so multi-line
// content and embedded <, >, quotes are safe.
// ---------------------------------------------------------------------------
const INVOKE_OPEN = /<(?:antml:)?invoke\s+name=["']([^"']+)["']\s*>/gi;

function extractXmlInvokes(text) {
	const results = [];
	INVOKE_OPEN.lastIndex = 0;
	let m;
	while ((m = INVOKE_OPEN.exec(text)) !== null) {
		const name = m[1];
		const bodyStart = m.index + m[0].length;
		const closeRe = /<\/(?:antml:)?invoke\s*>/gi;
		closeRe.lastIndex = bodyStart;
		const closeMatch = closeRe.exec(text);
		if (!closeMatch) break; // incomplete; leave for streaming buffer logic
		const body = text.slice(bodyStart, closeMatch.index);
		const args = extractXmlParams(body);
		results.push({
			name,
			args,
			start: m.index,
			end: closeMatch.index + closeMatch[0].length,
		});
		INVOKE_OPEN.lastIndex = closeMatch.index + closeMatch[0].length;
	}
	return results;
}

function extractXmlParams(body) {
	const args = {};
	const paramOpen = /<(?:antml:)?parameter\s+name=["']([^"']+)["']\s*>/gi;
	let m;
	while ((m = paramOpen.exec(body)) !== null) {
		const key = m[1];
		const valStart = m.index + m[0].length;
		const closeRe = /<\/(?:antml:)?parameter\s*>/gi;
		closeRe.lastIndex = valStart;
		const closeMatch = closeRe.exec(body);
		if (!closeMatch) break;
		const rawVal = body.slice(valStart, closeMatch.index);
		args[key] = coerceValue(rawVal);
		paramOpen.lastIndex = closeMatch.index + closeMatch[0].length;
	}
	return args;
}

// ---------------------------------------------------------------------------
// Dialect B: legacy ```tool:<name> key="v"\n<body>``` fenced blocks.
// The header line may carry inline key="value" params; the body may be JSON,
// key=value pairs, or plain text.
// ---------------------------------------------------------------------------
const TOOL_FENCE =
	/```tool:([A-Za-z0-9_.:-]+)([^\n`]*)\r?\n([\s\S]*?)```/gi;
const HEADER_PARAM =
	/([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;

function parseHeaderParams(headerStr) {
	const result = {};
	if (!headerStr) return result;
	HEADER_PARAM.lastIndex = 0;
	let m;
	while ((m = HEADER_PARAM.exec(headerStr)) !== null) {
		const key = m[1];
		result[key] = coerceValue(m[2] ?? m[3] ?? m[4] ?? "");
	}
	return result;
}

function toolFenceArgs(headerStr, body) {
	const trimmedBody = (body ?? "").trim();
	// Prefer a JSON object/array body.
	if (trimmedBody.startsWith("{") || trimmedBody.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmedBody);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed;
			}
		} catch {
			// fall through to header/params handling
		}
	}
	const headerParams = parseHeaderParams(headerStr);
	if (Object.keys(headerParams).length > 0 && trimmedBody === "") {
		return headerParams;
	}
	if (trimmedBody === "") return headerParams;
	// Non-JSON body: merge header params + wrap remaining text.
	return { ...headerParams, input: trimmedBody };
}

function extractToolFences(text) {
	const results = [];
	TOOL_FENCE.lastIndex = 0;
	let m;
	let safety = 0;
	while ((m = TOOL_FENCE.exec(text)) !== null) {
		if (++safety > 100) break;
		const name = m[1];
		const args = toolFenceArgs(m[2], m[3]);
		results.push({
			name,
			args,
			start: m.index,
			end: m.index + m[0].length,
		});
	}
	return results;
}

// ---------------------------------------------------------------------------
// Dialect C/D: loose JSON objects embedded in text, via brace-matching scan.
// ---------------------------------------------------------------------------
function extractJsonObjects(text) {
	const objs = [];
	let depth = 0;
	let startIdx = -1;
	let inString = false;
	let escape = false;
	let quote = "";
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escape) {
				escape = false;
			} else if (ch === "\\") {
				escape = true;
			} else if (ch === quote) {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
			quote = ch;
			continue;
		}
		if (ch === "{") {
			if (depth === 0) startIdx = i;
			depth++;
		} else if (ch === "}") {
			if (depth > 0) {
				depth--;
				if (depth === 0 && startIdx !== -1) {
					objs.push({
						raw: text.slice(startIdx, i + 1),
						start: startIdx,
						end: i + 1,
					});
					startIdx = -1;
				}
			}
		}
	}
	return objs;
}

function jsonObjToToolCall(raw) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		return null;

	const name =
		parsed.name ??
		parsed.tool ??
		parsed.tool_name ??
		(parsed.function && parsed.function.name) ??
		(typeof parsed.function === "string" ? parsed.function : undefined);
	const rawArgs =
		parsed.arguments ??
		parsed.args ??
		parsed.parameters ??
		parsed.input ??
		(parsed.function && parsed.function.arguments);

	if (typeof name !== "string" || !name) return null;

	let argsObj = {};
	if (rawArgs != null) {
		if (typeof rawArgs === "string") {
			try {
				argsObj = JSON.parse(rawArgs);
			} catch {
				argsObj = { _raw: rawArgs };
			}
		} else if (typeof rawArgs === "object") {
			argsObj = rawArgs;
		}
	}
	return { name, args: argsObj };
}

// ---------------------------------------------------------------------------
// Batch API: parse a full text blob into an ordered list of OpenAI tool calls.
// Priority: XML invokes and tool fences are captured first; a loose-JSON scan
// runs only on regions not already consumed (to avoid double-capture of the
// JSON that lives inside a tool fence).
// ---------------------------------------------------------------------------
export function parseToolCalls(fullText) {
	if (typeof fullText !== "string" || fullText.length === 0) return [];

	const xml = extractXmlInvokes(fullText);
	const fences = extractToolFences(fullText);
	const consumed = [...xml, ...fences].map((x) => [x.start, x.end]);

	const jsonCandidates = extractJsonObjects(fullText).filter((o) => {
		return !consumed.some(([s, e]) => o.start >= s && o.end <= e);
	});

	const items = [];
	for (const x of xml) items.push({ pos: x.start, name: x.name, args: x.args });
	for (const f of fences)
		items.push({ pos: f.start, name: f.name, args: f.args });
	for (const o of jsonCandidates) {
		const tc = jsonObjToToolCall(o.raw);
		if (tc) items.push({ pos: o.start, name: tc.name, args: tc.args });
	}
	items.sort((a, b) => a.pos - b.pos);

	return items.map((it) => toOpenAI(it.name, it.args));
}

// ---------------------------------------------------------------------------
// Streaming API.
// Feed chunks via push(); receive events. Call flush() at stream end.
// Events:
//   { type:"tool_start", index, id, name }
//   { type:"tool_delta", index, argumentsDelta }
//   { type:"tool_end",   index, toolCall }
//   { type:"text",       content }
// ---------------------------------------------------------------------------
export class StreamingToolCallParser {
	constructor(opts = {}) {
		this.buffer = "";
		this.index = 0;
		this.emitText = opts.emitText !== false; // default true
	}

	push(chunk) {
		if (typeof chunk !== "string" || chunk.length === 0) return [];
		this.buffer += chunk;
		return this._drain(false);
	}

	flush() {
		const events = this._drain(true);
		if (this.emitText && this.buffer.trim().length > 0) {
			events.push({ type: "text", content: this.buffer });
		}
		this.buffer = "";
		return events;
	}

	_drain(isFinal) {
		const events = [];

		// eslint-disable-next-line no-constant-condition
		while (true) {
			const next = this._findEarliestComplete();
			if (!next) break;

			if (this.emitText && next.start > 0) {
				const pre = this.buffer.slice(0, next.start);
				if (pre.trim().length > 0) events.push({ type: "text", content: pre });
			}

			const idx = this.index++;
			const id = genId();
			events.push({ type: "tool_start", index: idx, id, name: next.name });
			const argsStr = JSON.stringify(next.args ?? {});
			events.push({ type: "tool_delta", index: idx, argumentsDelta: argsStr });
			events.push({
				type: "tool_end",
				index: idx,
				toolCall: toOpenAI(next.name, next.args, id),
			});

			this.buffer = this.buffer.slice(next.end);
		}

		if (!isFinal) {
			const safeUpto = this._safeTextBoundary();
			if (this.emitText && safeUpto > 0) {
				const txt = this.buffer.slice(0, safeUpto);
				if (txt.trim().length > 0) events.push({ type: "text", content: txt });
				this.buffer = this.buffer.slice(safeUpto);
			}
		}

		return events;
	}

	// Earliest COMPLETE call (xml invoke, tool fence, or balanced json) in buffer.
	_findEarliestComplete() {
		let best = null;
		const consider = (start, end, name, args) => {
			if (!best || start < best.start) best = { start, end, name, args };
		};

		const xml = extractXmlInvokes(this.buffer);
		if (xml.length > 0) consider(xml[0].start, xml[0].end, xml[0].name, xml[0].args);

		const fences = extractToolFences(this.buffer);
		if (fences.length > 0)
			consider(fences[0].start, fences[0].end, fences[0].name, fences[0].args);

		const jsons = extractJsonObjects(this.buffer);
		for (const o of jsons) {
			const tc = jsonObjToToolCall(o.raw);
			if (!tc) continue;
			consider(o.start, o.end, tc.name, tc.args);
			break;
		}
		return best;
	}

	// How much of the buffer is definitely plain text (no partial call start).
	_safeTextBoundary() {
		const buf = this.buffer;
		for (let i = 0; i < buf.length; i++) {
			const ch = buf[i];
			if (ch === "{") return i; // any '{' could begin a JSON tool call
			if (ch === "<" && this._couldStartXmlCall(buf.slice(i))) return i;
			if (ch === "`" && this._couldStartToolFence(buf.slice(i))) return i;
		}
		return buf.length;
	}

	_couldStartXmlCall(frag) {
		const openers = ["<invoke", "</invoke", "<parameter", "</parameter"];
		for (const op of openers) {
			if (op.startsWith(frag) || frag.startsWith(op)) return true;
		}
		return false;
	}

	// A backtick run that could be the start of a ```tool: fence. Ordinary code
	// fences (```js, ```python, …) diverge from "```tool:" and are NOT held back.
	_couldStartToolFence(frag) {
		const opener = "```tool:";
		return opener.startsWith(frag) || frag.startsWith(opener);
	}
}

// Convenience: collect only final tool calls from a streaming run.
export function streamToToolCalls(chunks) {
	const p = new StreamingToolCallParser({ emitText: false });
	const calls = [];
	const handle = (evts) => {
		for (const e of evts) if (e.type === "tool_end") calls.push(e.toolCall);
	};
	for (const c of chunks) handle(p.push(c));
	handle(p.flush());
	return calls;
}

export const __test__ = {
	extractXmlInvokes,
	extractToolFences,
	extractJsonObjects,
	jsonObjToToolCall,
	toolFenceArgs,
};

export default { parseToolCalls, StreamingToolCallParser, streamToToolCalls };
