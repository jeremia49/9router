"use client";

import { useState, useEffect, useRef } from "react";
import Card from "@/shared/components/Card";
import { cn } from "@/shared/utils/cn";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";
import RequestDetailsTab from "@/app/(dashboard)/dashboard/usage/components/RequestDetailsTab";

let providerNameCache = null;
let providerNodesCache = null;

async function fetchProviderNames() {
  if (providerNameCache && providerNodesCache) {
    return { providerNameCache, providerNodesCache };
  }

  const nodesRes = await fetch("/api/provider-nodes");
  const nodesData = await nodesRes.json();
  const nodes = nodesData.nodes || [];
  providerNodesCache = {};

  for (const node of nodes) {
    providerNodesCache[node.id] = node.name;
  }

  providerNameCache = {
    ...AI_PROVIDERS,
    ...providerNodesCache
  };

  return { providerNameCache, providerNodesCache };
}

function getProviderName(providerId, cache) {
  if (!providerId) return providerId;
  if (!cache) return providerId;

  const cached = cache[providerId];

  if (typeof cached === 'string') {
    return cached;
  }

  if (cached?.name) {
    return cached.name;
  }

  const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
  return providerConfig?.name || providerId;
}

function CollapsibleSection({ title, children, defaultOpen = false, icon = null }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-black/5 dark:border-white/5 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon && <span className="material-symbols-outlined text-[18px] text-text-muted">{icon}</span>}
          <span className="font-semibold text-sm text-text-main">{title}</span>
        </div>
        <span className={cn(
          "material-symbols-outlined text-[20px] text-text-muted transition-transform duration-200",
          isOpen ? "rotate-90" : ""
        )}>
          chevron_right
        </span>
      </button>

      {isOpen && (
        <div className="p-4 border-t border-black/5 dark:border-white/5">
          {children}
        </div>
      )}
    </div>
  );
}

function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
}

function LiveCard({ request, providerCache, now }) {
  const preRef = useRef(null);
  const content = request.content || "";
  const thinking = request.thinking || "";

  // Auto-scroll output to bottom on update.
  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [content]);

  const providerName = getProviderName(request.provider, providerCache);
  const elapsed = formatElapsed(now - request.startedAt);

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-text-main">{providerName}</span>
        <span className="text-text-muted">·</span>
        <span className="font-mono text-xs text-text-muted">{request.model}</span>
        {request.account && (
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs text-text-muted dark:bg-white/10">
            {request.account}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-text-muted">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          {elapsed}
        </span>
      </div>

      {request.preview && (
        <p className="line-clamp-2 text-xs text-text-muted">{request.preview}</p>
      )}

      {thinking && (
        <pre className="max-h-[160px] max-w-full overflow-auto rounded-lg border border-amber-200 bg-amber-50 p-3 font-mono text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          {thinking}
        </pre>
      )}

      <pre
        ref={preRef}
        className="max-h-[300px] min-h-[48px] max-w-full overflow-auto whitespace-pre-wrap rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5"
      >
        {content || (request.status === "pending" ? "Waiting for response…" : "")}
      </pre>

      <CollapsibleSection title="View full input" icon="input">
        <pre className="max-h-[300px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5">
          {JSON.stringify(request.input, null, 2)}
        </pre>
      </CollapsibleSection>
    </Card>
  );
}

export default function LiveRequestsClient() {
  const [requests, setRequests] = useState(() => new Map());
  const [providerCache, setProviderCache] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  // Provider name cache
  useEffect(() => {
    let cancelled = false;
    fetchProviderNames()
      .then(({ providerNameCache }) => {
        if (!cancelled) setProviderCache(providerNameCache);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 1s tick for elapsed timers
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Live SSE
  useEffect(() => {
    const es = new EventSource("/api/usage/live-stream");
    es.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      setRequests((prev) => {
        const next = new Map(prev);
        if (msg.type === "snapshot") {
          next.clear();
          for (const r of msg.requests || []) next.set(r.id, r);
        } else if (msg.type === "start") {
          next.set(msg.request.id, msg.request);
        } else if (msg.type === "delta") {
          for (const u of msg.updates || []) {
            const rec = next.get(u.id);
            if (rec) {
              next.set(u.id, {
                ...rec,
                content: (rec.content || "") + (u.content || ""),
                thinking: (rec.thinking || "") + (u.thinking || ""),
                status: "streaming",
              });
            }
          }
        } else if (msg.type === "end") {
          next.delete(msg.id);
        }
        return next;
      });
    };
    return () => es.close();
  }, []);

  const ongoing = [...requests.values()].sort((a, b) => a.startedAt - b.startedAt);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section className="flex min-w-0 flex-col gap-4">
        <h2 className="text-lg font-semibold text-text-main">Ongoing</h2>
        {ongoing.length === 0 ? (
          <p className="text-sm text-text-muted">
            No ongoing requests. If Observability is off in your profile, live capture is disabled.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {ongoing.map((r) => (
              <LiveCard key={r.id} request={r} providerCache={providerCache} now={now} />
            ))}
          </div>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-4">
        <h2 className="text-lg font-semibold text-text-main">History</h2>
        <RequestDetailsTab />
      </section>
    </div>
  );
}
