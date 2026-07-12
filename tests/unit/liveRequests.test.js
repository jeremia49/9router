// Guards the in-memory live-request registry: start/append/finish lifecycle,
// emitted events, delta batching, and the observability enable-gate.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Keep the enable-gate deterministic (default true) so lifecycle tests never
// touch the real settings DB. The gate-off test overrides this via doMock.
vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: vi.fn(async () => ({ enableObservability: true })),
}));

import { liveStart, liveAppend, liveFinish, getLiveRequests, clearLiveRequests, liveEmitter } from "@/lib/liveRequests.js";

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
    // liveFinish now retains records as "done"; hard-reset the in-memory
    // registry between tests via the same global slots the module uses.
    global._liveRequests?.clear?.();
    global._liveDeltaBuf?.clear?.();
    for (const t of global._liveEvictTimers?.values?.() ?? []) clearTimeout(t);
    global._liveEvictTimers?.clear?.();
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

  it("liveFinish retains the record as done and emits finish", async () => {
    liveStart({ id: "c", provider: "openai", model: "m", body: { messages: [{ role: "user", content: "hi" }] }, stream: true });
    liveAppend("c", { content: "partial" });

    const finished = waitEvent("finish");
    liveFinish("c", { tokens: { prompt_tokens: 3, completion_tokens: 5 } });

    const evt = await finished;
    expect(evt.id).toBe("c");
    expect(evt.status).toBe("done");
    expect(evt.content).toBe("partial");
    expect(evt.tokens).toEqual({ prompt_tokens: 3, completion_tokens: 5 });

    // Record stays visible (until TTL eviction), now marked done.
    const rec = getLiveRequests().find((r) => r.id === "c");
    expect(rec).toBeTruthy();
    expect(rec.status).toBe("done");
    expect(typeof rec.finishedAt).toBe("number");
  });

  it("a second liveFinish on a done record is a no-op", async () => {
    liveStart({ id: "d", provider: "openai", model: "m", body: { messages: [{ role: "user", content: "hi" }] }, stream: true });
    liveFinish("d");
    const rec1 = getLiveRequests().find((r) => r.id === "d");
    const firstFinishedAt = rec1.finishedAt;

    let fired = false;
    const handler = () => { fired = true; };
    liveEmitter.on("finish", handler);
    liveFinish("d", { tokens: { prompt_tokens: 9 } });
    liveEmitter.off("finish", handler);

    const rec2 = getLiveRequests().find((r) => r.id === "d");
    expect(fired).toBe(false);
    expect(rec2.finishedAt).toBe(firstFinishedAt);
    expect(rec2.tokens).toBeNull();
  });

  it("getLiveRequests returns newest first", async () => {
    liveStart({ id: "older", provider: "openai", model: "m", body: {}, stream: true });
    await new Promise((r) => setTimeout(r, 5));
    liveStart({ id: "newer", provider: "openai", model: "m", body: {}, stream: true });

    const recs = getLiveRequests();
    expect(recs[0].id).toBe("newer");
    expect(recs[1].id).toBe("older");
  });

  it("clearLiveRequests empties the registry and emits clear", async () => {
    liveStart({ id: "e1", provider: "openai", model: "m", body: {}, stream: true });
    liveStart({ id: "e2", provider: "openai", model: "m", body: {}, stream: true });
    expect(getLiveRequests()).toHaveLength(2);

    const cleared = waitEvent("clear");
    clearLiveRequests();
    await cleared;

    expect(getLiveRequests()).toHaveLength(0);
  });

  it("liveFinish auto-evicts after 10s when liveAutoDelete is on", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db/repos/settingsRepo.js", () => ({
      getSettings: async () => ({ enableObservability: true, liveAutoDelete: true }),
    }));
    const mod = await import("@/lib/liveRequests.js");

    // Warm the settings cache so the auto-delete flag resolves before we finish.
    mod.liveStart({ id: "warm", provider: "openai", model: "m", body: {}, stream: true });
    await new Promise((r) => setTimeout(r, 50));

    vi.useFakeTimers();
    try {
      mod.liveStart({ id: "auto", provider: "openai", model: "m", body: {}, stream: true });
      mod.liveFinish("auto");
      expect(mod.getLiveRequests().some((r) => r.id === "auto")).toBe(true);

      vi.advanceTimersByTime(10000);
      expect(mod.getLiveRequests().some((r) => r.id === "auto")).toBe(false);
    } finally {
      vi.useRealTimers();
    }

    vi.doUnmock("@/lib/db/repos/settingsRepo.js");
    vi.resetModules();
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
