// Guards the in-memory live-request registry: start/append/finish lifecycle,
// emitted events, delta batching, and the observability enable-gate.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Keep the enable-gate deterministic (default true) so lifecycle tests never
// touch the real settings DB. The gate-off test overrides this via doMock.
vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: vi.fn(async () => ({ enableObservability: true })),
}));

import { liveStart, liveAppend, liveFinish, getLiveRequests, liveEmitter } from "@/lib/liveRequests.js";

function waitEvent(name, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      liveEmitter.off(name, handler);
      reject(new Error(`timeout waiting for "${name}"`));
    }, timeoutMs);
    const handler = (payload) => {
      clearTimeout(timer);
      liveEmitter.off(name, handler);
      resolve(payload);
    };
    liveEmitter.on(name, handler);
  });
}

describe("liveRequests registry", () => {
  beforeEach(() => {
    for (const r of getLiveRequests()) liveFinish(r.id);
  });

  it("liveStart registers a pending record and emits start", async () => {
    const started = waitEvent("start");
    liveStart({ id: "a", provider: "openai", model: "m", body: { messages: [{ role: "user", content: "hi" }] }, stream: true });

    const evt = await started;
    expect(evt.id).toBe("a");

    const recs = getLiveRequests();
    expect(recs).toHaveLength(1);
    expect(recs[0].id).toBe("a");
    expect(recs[0].preview.startsWith("hi")).toBe(true);
    expect(recs[0].status).toBe("pending");
  });

  it("liveAppend accumulates content and emits a batched delta", async () => {
    liveStart({ id: "b", provider: "openai", model: "m", body: { messages: [{ role: "user", content: "hi" }] }, stream: true });

    const delta = waitEvent("delta");
    liveAppend("b", { content: "foo" });

    const evt = await delta;
    expect(evt.updates).toEqual([{ id: "b", content: "foo", thinking: "" }]);

    const rec = getLiveRequests().find((r) => r.id === "b");
    expect(rec.content).toBe("foo");
    expect(rec.status).toBe("streaming");
  });

  it("liveFinish removes the record and emits end", async () => {
    liveStart({ id: "c", provider: "openai", model: "m", body: { messages: [{ role: "user", content: "hi" }] }, stream: true });
    expect(getLiveRequests().some((r) => r.id === "c")).toBe(true);

    const ended = waitEvent("end");
    liveFinish("c");

    const evt = await ended;
    expect(evt).toEqual({ id: "c" });
    expect(getLiveRequests().some((r) => r.id === "c")).toBe(false);
  });

  it("liveStart is a no-op when observability is disabled", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db/repos/settingsRepo.js", () => ({
      getSettings: async () => ({ enableObservability: false }),
    }));
    const mod = await import("@/lib/liveRequests.js");

    // First call uses the default-true cache and kicks the async settings fetch.
    mod.liveStart({ id: "gate-warm", provider: "openai", model: "m", body: {}, stream: false });
    mod.liveFinish("gate-warm");

    // Let the fire-and-forget getSettings resolve → cached flag flips to false.
    await new Promise((r) => setTimeout(r, 50));

    mod.liveStart({ id: "gate-off", provider: "openai", model: "m", body: { messages: [{ role: "user", content: "hi" }] }, stream: true });
    expect(mod.getLiveRequests().some((r) => r.id === "gate-off")).toBe(false);

    vi.doUnmock("@/lib/db/repos/settingsRepo.js");
    vi.resetModules();
  });
});
