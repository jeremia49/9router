import { afterEach, describe, expect, it, vi } from "vitest";

import { T3ChatExecutor, __test__ } from "../../open-sse/executors/t3chat.js";
import { T3ChatTransport } from "../../open-sse/executors/t3chatTransport.js";

afterEach(() => {
	__test__.setT3ChatTransportFactory(null);
});

const credentials = {
	providerSpecificData: { cookies: "c=1", convexSessionId: "convex" },
};

const tools = [
	{
		type: "function",
		function: {
			name: "bash",
			description: "Run a shell command",
			parameters: {
				type: "object",
				properties: { command: { type: "string" } },
				required: ["command"],
			},
		},
	},
];

// Build a T3Chat SSE body out of text-delta events for the given text.
function sseFromText(text, { chunk = 8 } = {}) {
	const lines = [];
	for (let i = 0; i < text.length; i += chunk) {
		const slice = text.slice(i, i + chunk);
		lines.push(`data: ${JSON.stringify({ type: "text-delta", delta: slice })}`);
	}
	lines.push('data: {"type":"finish","finishReason":"stop"}');
	lines.push("data: [DONE]");
	return lines.join("\n") + "\n";
}

function streamResponseFromText(text, opts) {
	const body = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(sseFromText(text, opts)));
			controller.close();
		},
	});
	return new Response(body, {
		status: 200,
		headers: { "Content-Type": "text/event-stream" },
	});
}

function mountTransport(post) {
	const transport = new T3ChatTransport();
	transport.post = post;
	__test__.setT3ChatTransportFactory(() => transport);
}

// Collect an OpenAI SSE stream Response into parsed chunk objects.
async function collectChunks(response) {
	const raw = await response.text();
	const chunks = [];
	for (const line of raw.split("\n")) {
		const t = line.trim();
		if (!t.startsWith("data:")) continue;
		const data = t.slice("data:".length).trim();
		if (data === "[DONE]") continue;
		try {
			chunks.push(JSON.parse(data));
		} catch {
			// Ignore any non-JSON keepalive lines.
		}
	}
	return chunks;
}

describe("T3Chat executor tool-call conversion (non-streaming)", () => {
	it("converts an emitted tool fence into OpenAI tool_calls", async () => {
		const modelText = 'Let me run it.\n```tool:bash\n{"command":"ls -la"}\n```';
		mountTransport(
			vi.fn().mockResolvedValue({ status: 200, text: sseFromText(modelText) }),
		);

		const result = await new T3ChatExecutor().execute({
			model: "gpt-4o-mini",
			body: { messages: [{ role: "user", content: "list files" }], tools },
			stream: false,
			credentials,
		});

		const json = await result.response.json();
		const choice = json.choices[0];
		expect(choice.finish_reason).toBe("tool_calls");
		expect(choice.message.tool_calls).toHaveLength(1);
		expect(choice.message.tool_calls[0]).toMatchObject({
			type: "function",
			function: { name: "bash", arguments: '{"command":"ls -la"}' },
		});
		// Narration is preserved; tool syntax is stripped from content.
		expect(choice.message.content).toContain("Let me run it.");
		expect(choice.message.content).not.toContain("```");
	});

	it("returns a plain assistant message when no tool syntax is emitted", async () => {
		const modelText = "Here is a plain answer with no tools.";
		mountTransport(
			vi.fn().mockResolvedValue({ status: 200, text: sseFromText(modelText) }),
		);

		const result = await new T3ChatExecutor().execute({
			model: "gpt-4o-mini",
			body: { messages: [{ role: "user", content: "hi" }], tools },
			stream: false,
			credentials,
		});

		const json = await result.response.json();
		const choice = json.choices[0];
		expect(choice.finish_reason).toBe("stop");
		expect(choice.message.tool_calls).toBeUndefined();
		expect(choice.message.content).toBe(modelText);
	});

	it("does not convert tool syntax when no tools are provided", async () => {
		const modelText = 'text ```tool:bash\n{"command":"whoami"}\n```';
		mountTransport(
			vi.fn().mockResolvedValue({ status: 200, text: sseFromText(modelText) }),
		);

		const result = await new T3ChatExecutor().execute({
			model: "gpt-4o-mini",
			body: { messages: [{ role: "user", content: "hi" }] },
			stream: false,
			credentials,
		});

		const json = await result.response.json();
		const choice = json.choices[0];
		expect(choice.finish_reason).toBe("stop");
		expect(choice.message.tool_calls).toBeUndefined();
	});
});

describe("T3Chat executor tool-call conversion (streaming)", () => {
	it("emits OpenAI tool_call chunks for an emitted tool fence", async () => {
		const modelText = 'Working.\n```tool:bash\n{"command":"pwd"}\n```';
		mountTransport(
			vi.fn().mockResolvedValue({
				status: 200,
				response: streamResponseFromText(modelText, { chunk: 5 }),
			}),
		);

		const result = await new T3ChatExecutor().execute({
			model: "gpt-4o-mini",
			body: { messages: [{ role: "user", content: "pwd" }], tools },
			stream: true,
			credentials,
		});

		const chunks = await collectChunks(result.response);

		// Reassemble the streamed tool call.
		let name = "";
		let args = "";
		let finish = null;
		let leakedContent = "";
		for (const c of chunks) {
			const delta = c.choices?.[0]?.delta ?? {};
			if (delta.tool_calls) {
				for (const tc of delta.tool_calls) {
					if (tc.function?.name) name += tc.function.name;
					if (tc.function?.arguments) args += tc.function.arguments;
				}
			}
			if (typeof delta.content === "string") leakedContent += delta.content;
			if (c.choices?.[0]?.finish_reason) finish = c.choices[0].finish_reason;
		}

		expect(name).toBe("bash");
		expect(args).toBe('{"command":"pwd"}');
		expect(finish).toBe("tool_calls");
		// Narration streamed, but no tool syntax leaked into content.
		expect(leakedContent).toContain("Working.");
		expect(leakedContent).not.toContain("```");
	});

	it("streams plain content with finish=stop when no tool syntax appears", async () => {
		const modelText = "Just a normal streamed reply.";
		mountTransport(
			vi.fn().mockResolvedValue({
				status: 200,
				response: streamResponseFromText(modelText, { chunk: 6 }),
			}),
		);

		const result = await new T3ChatExecutor().execute({
			model: "gpt-4o-mini",
			body: { messages: [{ role: "user", content: "hi" }], tools },
			stream: true,
			credentials,
		});

		const chunks = await collectChunks(result.response);
		let content = "";
		let finish = null;
		let sawToolCall = false;
		for (const c of chunks) {
			const delta = c.choices?.[0]?.delta ?? {};
			if (typeof delta.content === "string") content += delta.content;
			if (delta.tool_calls) sawToolCall = true;
			if (c.choices?.[0]?.finish_reason) finish = c.choices[0].finish_reason;
		}

		expect(content).toBe(modelText);
		expect(sawToolCall).toBe(false);
		expect(finish).toBe("stop");
	});
});
