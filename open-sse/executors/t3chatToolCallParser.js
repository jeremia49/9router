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
// Shared: best-effort JSON parse + JSON-style string unescaping.
// ---------------------------------------------------------------------------
function tryParseJson(s) {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}

// Decode the common JSON/C string escapes so attribute values that embed
// \n / \t / \" round-trip into real characters. Unrecognized escapes and bare
// (unescaped) characters are preserved verbatim, so partially/loosely escaped
// model output degrades gracefully instead of being dropped.
function unescapeString(s) {
	if (typeof s !== "string" || s.indexOf("\\") === -1) return s;
	return s.replace(
		/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g,
		(whole, esc) => {
			const c = esc[0];
			switch (c) {
				case '"':
					return '"';
				case "'":
					return "'";
				case "\\":
					return "\\";
				case "/":
					return "/";
				case "b":
					return "\b";
				case "f":
					return "\f";
				case "n":
					return "\n";
				case "r":
					return "\r";
				case "t":
					return "\t";
				case "u":
					return String.fromCharCode(parseInt(esc.slice(1), 16));
				case "x":
					return String.fromCharCode(parseInt(esc.slice(1), 16));
				default:
					return whole; // preserve unknown escape verbatim
			}
		},
	);
}

// ---------------------------------------------------------------------------
// Dialect B: ```tool:<name> ...``` fenced blocks.
//
// Two body styles are supported and auto-detected:
//   B1. JSON body:      ```tool:write\n{"path":"a","content":"..."}\n```
//   B2. header attrs:   ```tool:write path="a" content="<!DOCTYPE html>\n..."```
//
// The header-attribute style (emitted by minimax / deepseek and others) puts a
// possibly HUGE, multi-line `content="..."` value on the header line. Naive
// line-oriented parsing truncated that value at the first newline / first inner
// quote (the "<!DOCTYPE" bug), so the file body was lost. parseFenceAttributes
// below reads such values across newlines and tolerates both escaped (\") and
// unescaped inner quotes by making the final attribute greedy.
// ---------------------------------------------------------------------------
const TOOL_FENCE_OPEN = /```tool:([A-Za-z0-9_.:-]+)/gi;

// Parse `key="value"` / `key=token` attributes out of a tool-fence region.
// Robust to multi-line values and unescaped inner quotes.
function parseFenceAttributes(region) {
	const args = {};
	const n = region.length;
	let i = 0;
	const keyRe = /^([A-Za-z_][\w-]*)\s*=\s*/;
	while (i < n) {
		while (i < n && /\s/.test(region[i])) i++;
		if (i >= n) break;
		const km = keyRe.exec(region.slice(i));
		if (!km) break; // no more attributes
		const key = km[1];
		i += km[0].length;
		if (region[i] === '"' || region[i] === "'") {
			const quote = region[i];
			i++; // consume opening quote
			const start = i;
			// Find the first UNescaped matching quote (the "proper" close).
			let j = i;
			let properEnd = -1;
			while (j < n) {
				if (region[j] === "\\") {
					j += 2;
					continue;
				}
				if (region[j] === quote) {
					properEnd = j;
					break;
				}
				j++;
			}
			let end;
			if (properEnd === -1) {
				end = n; // unterminated value: take the rest
			} else {
				const rest = region.slice(properEnd + 1);
				// Accept the proper close only when what follows looks like the end
				// of the attribute list or the next attribute. Otherwise the value
				// has unescaped inner quotes (e.g. HTML lang="en") -> go greedy to
				// the LAST quote in the region so the whole body is captured.
				if (/^\s*$/.test(rest) || /^\s*[A-Za-z_][\w-]*\s*=/.test(rest)) {
					end = properEnd;
				} else {
					const lastQuote = region.lastIndexOf(quote);
					end = lastQuote > start ? lastQuote : n;
				}
			}
			args[key] = unescapeString(region.slice(start, end));
			i = end + 1;
		} else {
			const tok = /^(\S+)/.exec(region.slice(i));
			if (!tok) break;
			args[key] = coerceValue(tok[1]);
			i += tok[1].length;
		}
	}
	return args;
}

function toolFenceArgs(region) {
	const trimmed = (region ?? "").trim();
	// B1: JSON object/array body.
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		const parsed = tryParseJson(trimmed);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed;
		}
	}
	// B2: key="value" header attributes (possibly multi-line values).
	if (/[A-Za-z_][\w-]*\s*=\s*["'\S]/.test(region)) {
		const attrs = parseFenceAttributes(region.replace(/^\r?\n/, ""));
		if (Object.keys(attrs).length > 0) return attrs;
	}
	if (trimmed === "") return {};
	// Plain-text body: wrap under a generic `input` key.
	return { input: trimmed };
}

// allowUnterminated: when true (batch / stream flush), a fence whose closing
// ``` never arrived is still parsed from whatever body was received, so a
// truncated tool call is recovered instead of leaking as raw text.
function extractToolFences(text, { allowUnterminated = false } = {}) {
	const results = [];
	TOOL_FENCE_OPEN.lastIndex = 0;
	let m;
	let safety = 0;
	while ((m = TOOL_FENCE_OPEN.exec(text)) !== null) {
		if (++safety > 100) break;
		const name = m[1];
		const regionStart = m.index + m[0].length;
		const closeIdx = text.indexOf("```", regionStart);
		let region;
		let end;
		if (closeIdx === -1) {
			if (!allowUnterminated) continue; // wait for more data (streaming)
			region = text.slice(regionStart);
			end = text.length;
		} else {
			region = text.slice(regionStart, closeIdx);
			end = closeIdx + 3;
		}
		results.push({ name, args: toolFenceArgs(region), start: m.index, end });
		TOOL_FENCE_OPEN.lastIndex = end;
	}
	return results;
}

// ---------------------------------------------------------------------------
// Dialect E: OpenAI "harmony" tokens emitted by gpt-oss models.
//   <|start|>assistant<|channel|>commentary to=tool:write <|constrain|>json
//   <|message|>{ ...json... }<|call|>
// The tool target may be `tool:NAME`, `functions.NAME`, or bare `NAME`.
// ---------------------------------------------------------------------------
const HARMONY_CALL =
	/(?:<\|start\|>[^<]*)?(?:<\|channel\|>[\s\S]*?)?to=(?:tool[:.]|functions?[:.])?([A-Za-z0-9_.:-]+)[\s\S]*?<\|message\|>([\s\S]*?)<\|call\|>/gi;

function harmonyArgs(body) {
	const trimmed = (body ?? "").trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		const parsed = tryParseJson(trimmed);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed;
		}
	}
	if (trimmed === "") return {};
	return { input: trimmed };
}

function extractHarmonyCalls(text) {
	const results = [];
	HARMONY_CALL.lastIndex = 0;
	let m;
	let safety = 0;
	while ((m = HARMONY_CALL.exec(text)) !== null) {
		if (++safety > 100) break;
		results.push({
			name: m[1],
			args: harmonyArgs(m[2]),
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
	const harmony = extractHarmonyCalls(fullText);
	const fences = extractToolFences(fullText, { allowUnterminated: true });
	const consumed = [...xml, ...harmony, ...fences].map((x) => [x.start, x.end]);

	const jsonCandidates = extractJsonObjects(fullText).filter((o) => {
		return !consumed.some(([s, e]) => o.start >= s && o.end <= e);
	});

	const items = [];
	for (const x of xml) items.push({ pos: x.start, name: x.name, args: x.args });
	for (const h of harmony)
		items.push({ pos: h.start, name: h.name, args: h.args });
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

		while (true) {
			const next = this._findEarliestComplete(isFinal);
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

	// Earliest COMPLETE call (xml, harmony, tool fence, or balanced json) in
	// buffer. When isFinal, an unterminated tool fence is also recovered so a
	// truncated final call is not lost.
	_findEarliestComplete(isFinal = false) {
		let best = null;
		const consider = (start, end, name, args) => {
			if (!best || start < best.start) best = { start, end, name, args };
		};

		const xml = extractXmlInvokes(this.buffer);
		if (xml.length > 0)
			consider(xml[0].start, xml[0].end, xml[0].name, xml[0].args);

		const harmony = extractHarmonyCalls(this.buffer);
		if (harmony.length > 0)
			consider(
				harmony[0].start,
				harmony[0].end,
				harmony[0].name,
				harmony[0].args,
			);

		const fences = extractToolFences(this.buffer, {
			allowUnterminated: isFinal,
		});
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
			if (ch === "<") {
				const frag = buf.slice(i);
				if (this._couldStartXmlCall(frag) || this._couldStartHarmony(frag))
					return i;
			}
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

	// A `<|...` run that could be the start of a harmony tool call. Any harmony
	// control token is held back until the closing <|call|> arrives.
	_couldStartHarmony(frag) {
		const opener = "<|";
		if (opener.startsWith(frag) || frag.startsWith(opener)) {
			// Once a full harmony call is present it is consumed by
			// _findEarliestComplete; holding back a lone "<|..." prefix here keeps a
			// partial call from leaking as text mid-stream.
			return true;
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
	extractHarmonyCalls,
	extractJsonObjects,
	jsonObjToToolCall,
	toolFenceArgs,
	parseFenceAttributes,
	unescapeString,
};

export default { parseToolCalls, StreamingToolCallParser, streamToToolCalls };
