import { afterEach, describe, expect, it, vi } from "vitest";

import { getExecutor } from "../../open-sse/executors/index.js";
import { T3ChatExecutor, __test__ } from "../../open-sse/executors/t3chat.js";
import { T3ChatTransport } from "../../open-sse/executors/t3chatTransport.js";

afterEach(() => {
	__test__.setT3ChatTransportFactory(null);
});

describe("T3ChatExecutor", () => {
	it("is registered by provider id", () => {
		expect(getExecutor("t3chat")).toBeInstanceOf(T3ChatExecutor);
	});

	it("posts through transport and returns parsed text response (non-streaming)", async () => {
		const post = vi.fn().mockResolvedValue({
			status: 200,
			text: 'data: {"type":"text-delta","delta":"ok"}\ndata: [DONE]\n',
		});

		// Create a proper T3ChatTransport instance and spy on its post method
		const mockTransport = new T3ChatTransport();
		mockTransport.post = post;
		__test__.setT3ChatTransportFactory(() => mockTransport);

		const executor = new T3ChatExecutor();
		const result = await executor.execute({
			model: "gpt-4o-mini",
			body: { messages: [{ role: "user", content: "hi" }] },
			stream: false,
			credentials: {
				providerSpecificData: { cookies: "c=1", convexSessionId: "convex" },
			},
			log: { debug: vi.fn() },
		});

		expect(post).toHaveBeenCalledWith(
			"https://t3.chat/api/chat",
			expect.objectContaining({
				headers: expect.objectContaining({
					Cookie: "c=1",
					Origin: "https://t3.chat",
				}),
				json: expect.objectContaining({
					model: "gpt-4o-mini",
					convexSessionId: "convex",
				}),
			}),
		);
		expect(await result.response.text()).toContain("ok");
		expect(result.url).toBe("https://t3.chat/api/chat");
	});

	it("returns streaming response when stream=true", async () => {
		const mockBody = new ReadableStream({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						'data: {"type":"text-delta","delta":"Hello"}\n',
					),
				);
				controller.enqueue(
					new TextEncoder().encode(
						'data: {"type":"text-delta","delta":" world"}\n',
					),
				);
				controller.enqueue(new TextEncoder().encode("data: [DONE]\n"));
				controller.close();
			},
		});

		const mockResponse = new Response(mockBody, {
			status: 200,
			headers: { "Content-Type": "text/event-stream" },
		});

		const post = vi.fn().mockResolvedValue({
			status: 200,
			response: mockResponse,
		});

		// Create a proper T3ChatTransport instance
		const mockTransport = new T3ChatTransport();
		mockTransport.post = post;
		__test__.setT3ChatTransportFactory(() => mockTransport);

		const executor = new T3ChatExecutor();
		const result = await executor.execute({
			model: "gpt-4o-mini",
			body: { messages: [{ role: "user", content: "hi" }] },
			stream: true,
			credentials: {
				providerSpecificData: { cookies: "c=1", convexSessionId: "convex" },
			},
			log: { debug: vi.fn() },
		});

		expect(post).toHaveBeenCalledWith(
			"https://t3.chat/api/chat",
			expect.objectContaining({
				headers: expect.objectContaining({
					Cookie: "c=1",
					Origin: "https://t3.chat",
				}),
				json: expect.objectContaining({
					model: "gpt-4o-mini",
					convexSessionId: "convex",
				}),
			}),
		);
		expect(result.response.headers.get("Content-Type")).toBe(
			"text/event-stream",
		);
		expect(result.url).toBe("https://t3.chat/api/chat");
	});

	it("maps auth and rate-limit errors clearly", async () => {
		const mockTransport403 = new T3ChatTransport();
		mockTransport403.post = vi
			.fn()
			.mockResolvedValue({ status: 403, text: "no" });
		__test__.setT3ChatTransportFactory(() => mockTransport403);

		await expect(
			new T3ChatExecutor().execute({
				model: "gpt-4o-mini",
				body: { messages: [{ role: "user", content: "hi" }] },
				stream: false,
				credentials: {
					providerSpecificData: { cookies: "c=1", convexSessionId: "convex" },
				},
			}),
		).rejects.toThrow("T3Chat rejected the provided session");

		const mockTransport429 = new T3ChatTransport();
		mockTransport429.post = vi
			.fn()
			.mockResolvedValue({ status: 429, text: "limit" });
		__test__.setT3ChatTransportFactory(() => mockTransport429);
		await expect(
			new T3ChatExecutor().execute({
				model: "gpt-4o-mini",
				body: { messages: [{ role: "user", content: "hi" }] },
				stream: false,
				credentials: {
					providerSpecificData: { cookies: "c=1", convexSessionId: "convex" },
				},
			}),
		).rejects.toThrow("T3Chat returned HTTP 429");
	});

	it("enforces T3ChatTransport instance (wreq-js requirement)", async () => {
		// Mock a non-T3ChatTransport object
		const fakeTransport = {
			post: vi.fn().mockResolvedValue({ status: 200, text: "ok" }),
		};
		__test__.setT3ChatTransportFactory(() => fakeTransport);

		const executor = new T3ChatExecutor();
		await expect(
			executor.execute({
				model: "gpt-4o-mini",
				body: { messages: [{ role: "user", content: "hi" }] },
				stream: false,
				credentials: {
					providerSpecificData: { cookies: "c=1", convexSessionId: "convex" },
				},
			}),
		).rejects.toThrow("T3Chat provider MUST use T3ChatTransport with wreq-js");
	});
});
