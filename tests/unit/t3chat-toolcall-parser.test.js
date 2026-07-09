import { describe, expect, it } from "vitest";

import {
	parseToolCalls,
	StreamingToolCallParser,
	streamToToolCalls,
} from "../../open-sse/executors/t3chatToolCallParser.js";

// Split a string into small fixed-size chunks to simulate streaming.
function chunkify(str, size = 5) {
	const chunks = [];
	for (let i = 0; i < str.length; i += size) chunks.push(str.slice(i, i + size));
	return chunks;
}

// Normalize tool calls to name+arguments for stable comparison.
const norm = (arr) =>
	arr.map((c) => ({ name: c.function.name, arguments: c.function.arguments }));

describe("t3chat universal tool-call parser (batch)", () => {
	it("parses the legacy ```tool:name``` fence with a JSON body", () => {
		const text = 'Sure.\n```tool:bash\n{"command":"ls -la"}\n```';
		expect(norm(parseToolCalls(text))).toEqual([
			{ name: "bash", arguments: '{"command":"ls -la"}' },
		]);
	});

	it("parses tool fence header params when the body is empty", () => {
		const text = '```tool:todo action="update" id=1\n```';
		expect(norm(parseToolCalls(text))).toEqual([
			{ name: "todo", arguments: '{"action":"update","id":1}' },
		]);
	});

	it("wraps a non-JSON tool fence body under `input`", () => {
		const text = "```tool:search\nopenai tool calling\n```";
		expect(norm(parseToolCalls(text))).toEqual([
			{ name: "search", arguments: '{"input":"openai tool calling"}' },
		]);
	});

	it("parses XML-style <invoke>/<parameter> calls", () => {
		const text =
			'<invoke name="write"><parameter name="path">a.txt</parameter><parameter name="content">hi</parameter></invoke>';
		expect(norm(parseToolCalls(text))).toEqual([
			{ name: "write", arguments: '{"path":"a.txt","content":"hi"}' },
		]);
	});

	it("parses loose inline JSON {name, arguments}", () => {
		const text = 'ok {"name":"get_weather","arguments":{"city":"Jakarta"}} done';
		expect(norm(parseToolCalls(text))).toEqual([
			{ name: "get_weather", arguments: '{"city":"Jakarta"}' },
		]);
	});

	it("keeps multiple calls in source order across dialects", () => {
		const text =
			'<invoke name="bash"><parameter name="command">pwd</parameter></invoke>\n' +
			'then: {"name":"search","arguments":{"q":"x"}}';
		expect(norm(parseToolCalls(text)).map((c) => c.name)).toEqual([
			"bash",
			"search",
		]);
	});

	it("does not double-capture JSON that lives inside a tool fence", () => {
		const text = '```tool:calc\n{"a":1,"b":2}\n```';
		const calls = parseToolCalls(text);
		expect(calls).toHaveLength(1);
		expect(calls[0].function.name).toBe("calc");
	});

	it("returns [] for pure narration", () => {
		expect(parseToolCalls("just talking, no tools here")).toEqual([]);
	});
});

describe("t3chat universal tool-call parser (streaming)", () => {
	const dialects = {
		"tool fence json": 'Sure.\n```tool:bash\n{"command":"ls -la"}\n```',
		"tool fence header": '```tool:todo action="update" id=1\n```',
		xml: '<invoke name="bash"><parameter name="command">pwd</parameter></invoke>',
		"loose json": 'go {"name":"search","arguments":{"q":"x"}} end',
		"multiline content":
			'<invoke name="write"><parameter name="content">line1\nline2\n</parameter></invoke>',
	};

	for (const [label, text] of Object.entries(dialects)) {
		it(`streaming matches batch for ${label} (chunk=5)`, () => {
			expect(norm(streamToToolCalls(chunkify(text, 5)))).toEqual(
				norm(parseToolCalls(text)),
			);
		});

		it(`streaming matches batch for ${label} (chunk=1)`, () => {
			expect(norm(streamToToolCalls(chunkify(text, 1)))).toEqual(
				norm(parseToolCalls(text)),
			);
		});
	}

	it("never leaks partial tool syntax as narration text", () => {
		const text = 'Hi there.\n```tool:bash\n{"command":"echo hi"}\n```';
		const parser = new StreamingToolCallParser({ emitText: true });
		const narration = [];
		const events = [];
		for (const c of chunkify(text, 4)) {
			for (const e of parser.push(c)) {
				events.push(e);
				if (e.type === "text") narration.push(e.content);
			}
		}
		for (const e of parser.flush()) {
			events.push(e);
			if (e.type === "text") narration.push(e.content);
		}

		// Narration must be the leading prose only, with no backticks / tool syntax.
		const joined = narration.join("");
		expect(joined).toContain("Hi there.");
		expect(joined).not.toContain("```");
		expect(joined).not.toContain("tool:");
		// And a tool call must have been emitted.
		expect(events.some((e) => e.type === "tool_start" && e.name === "bash")).toBe(
			true,
		);
	});

	it("streams ordinary code fences as text (not tool calls)", () => {
		const text = "Here:\n```js\nconsole.log(1)\n```\ndone";
		expect(streamToToolCalls(chunkify(text, 3))).toEqual([]);
	});
});
