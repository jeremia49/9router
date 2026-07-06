import { afterEach, describe, expect, it, vi } from "vitest";

import { getExecutor } from "../../open-sse/executors/index.js";
import { T3ChatExecutor, __test__ } from "../../open-sse/executors/t3chat.js";

afterEach(() => {
  __test__.setT3ChatTransportFactory(null);
});

describe("T3ChatExecutor", () => {
  it("is registered by provider id", () => {
    expect(getExecutor("t3chat")).toBeInstanceOf(T3ChatExecutor);
  });

  it("posts through transport and returns parsed text response", async () => {
    const post = vi.fn().mockResolvedValue({
      status: 200,
      text: 'data: {"type":"text-delta","delta":"ok"}\ndata: [DONE]\n',
    });
    __test__.setT3ChatTransportFactory(() => ({ post }));

    const executor = new T3ChatExecutor();
    const result = await executor.execute({
      model: "gpt-4o-mini",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { providerSpecificData: { cookies: "c=1", convexSessionId: "convex" } },
      log: { debug: vi.fn() },
    });

    expect(post).toHaveBeenCalledWith("https://t3.chat/api/chat", expect.objectContaining({
      headers: expect.objectContaining({ Cookie: "c=1", Origin: "https://t3.chat" }),
      json: expect.objectContaining({ model: "gpt-4o-mini", convexSessionId: "convex" }),
    }));
    expect(await result.response.text()).toContain("ok");
    expect(result.url).toBe("https://t3.chat/api/chat");
  });

  it("maps auth and rate-limit errors clearly", async () => {
    __test__.setT3ChatTransportFactory(() => ({ post: vi.fn().mockResolvedValue({ status: 403, text: "no" }) }));
    await expect(new T3ChatExecutor().execute({
      model: "gpt-4o-mini",
      body: { messages: [{ role: "user", content: "hi" }] },
      credentials: { providerSpecificData: { cookies: "c=1", convexSessionId: "convex" } },
    })).rejects.toThrow("T3Chat rejected the provided session");

    __test__.setT3ChatTransportFactory(() => ({ post: vi.fn().mockResolvedValue({ status: 429, text: "limit" }) }));
    await expect(new T3ChatExecutor().execute({
      model: "gpt-4o-mini",
      body: { messages: [{ role: "user", content: "hi" }] },
      credentials: { providerSpecificData: { cookies: "c=1", convexSessionId: "convex" } },
    })).rejects.toThrow("T3Chat returned HTTP 429");
  });
});
