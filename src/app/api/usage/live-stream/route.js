import { liveEmitter, getLiveRequests } from "@/lib/liveRequests.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null };

  const stream = new ReadableStream({
    start(controller) {
      const send = (obj) => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          cleanup();
        }
      };

      const onStart = (request) => send({ type: "start", request });
      const onDelta = ({ updates }) => send({ type: "delta", updates });
      const onFinish = (request) => send({ type: "finish", request });
      const onEvict = ({ id }) => send({ type: "evict", id });

      function cleanup() {
        state.closed = true;
        liveEmitter.off("start", onStart);
        liveEmitter.off("delta", onDelta);
        liveEmitter.off("finish", onFinish);
        liveEmitter.off("evict", onEvict);
        clearInterval(state.keepalive);
      }
      state.cleanup = cleanup;

      // Subscribe first, then send snapshot so no live event is missed.
      liveEmitter.on("start", onStart);
      liveEmitter.on("delta", onDelta);
      liveEmitter.on("finish", onFinish);
      liveEmitter.on("evict", onEvict);

      send({ type: "snapshot", requests: getLiveRequests() });

      state.keepalive = setInterval(() => {
        if (state.closed) {
          clearInterval(state.keepalive);
          return;
        }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 25000);
    },

    cancel() {
      state.cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
