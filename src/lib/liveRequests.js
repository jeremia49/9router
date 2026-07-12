import { EventEmitter } from "events";

const LIVE_TTL_MS = 5 * 60 * 1000;
const LIVE_AUTO_DELETE_MS = 10 * 1000;
const DELTA_FLUSH_MS = 150;
const ENABLED_CACHE_TTL_MS = 5000;

// In-memory state shared across Next.js module instances (HMR-safe)
if (!global._liveRequests) global._liveRequests = new Map();
if (!global._liveEmitter) {
  global._liveEmitter = new EventEmitter();
  global._liveEmitter.setMaxListeners(0);
}
if (!global._liveDeltaBuf) global._liveDeltaBuf = new Map();
if (global._liveFlushTimer === undefined) global._liveFlushTimer = null;
if (!global._liveEvictTimers) global._liveEvictTimers = new Map();

const liveRequests = global._liveRequests;
const deltaBuf = global._liveDeltaBuf;
const evictTimers = global._liveEvictTimers;

export const liveEmitter = global._liveEmitter;

// --- Cached settings gate (off the hot path) --------------------------------
let cachedEnabled = true; // default true until first resolve (matches settings default)
let cachedAutoDelete = false; // default false until first resolve
let cachedSettingsTs = 0;

function refreshSettingsCache() {
  if (Date.now() - cachedSettingsTs >= ENABLED_CACHE_TTL_MS) {
    cachedSettingsTs = Date.now();
    import("@/lib/db/repos/settingsRepo.js")
      .then(({ getSettings }) => getSettings())
      .then((settings) => {
        cachedEnabled = settings.enableObservability === true;
        cachedAutoDelete = settings.liveAutoDelete === true;
      })
      .catch(() => {});
  }
}

function isLiveEnabled() {
  refreshSettingsCache();
  return cachedEnabled;
}

// Delay before a finished record is evicted: short when auto-delete is on so
// the registry stays small, otherwise the full TTL backstop.
function finishEvictMs() {
  refreshSettingsCache();
  return cachedAutoDelete ? LIVE_AUTO_DELETE_MS : LIVE_TTL_MS;
}

// --- Preview extraction -----------------------------------------------------
function textFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .filter(Boolean)
      .join("");
  }
  return "";
}

function truncate(str) {
  const s = (str || "").trim();
  return s.length > 300 ? s.slice(0, 300) + "…" : s;
}

function buildPreview(body) {
  if (!body || typeof body !== "object") return "";
  // OpenAI / Claude: messages[]
  if (Array.isArray(body.messages)) {
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const m = body.messages[i];
      if (m && m.role === "user") return truncate(textFromContent(m.content));
    }
    return "";
  }
  // Gemini: contents[]
  if (Array.isArray(body.contents)) {
    const last = body.contents[body.contents.length - 1];
    if (last && Array.isArray(last.parts)) {
      return truncate(last.parts.map((p) => p?.text || "").filter(Boolean).join(""));
    }
    return "";
  }
  // Responses API: input (string or array)
  if (body.input !== undefined) {
    if (typeof body.input === "string") return truncate(body.input);
    if (Array.isArray(body.input)) {
      const last = body.input[body.input.length - 1];
      if (last) return truncate(textFromContent(last.content ?? last.text));
    }
  }
  return "";
}

function publicRecord(rec) {
  return {
    id: rec.id,
    provider: rec.provider,
    model: rec.model,
    connectionId: rec.connectionId,
    account: rec.account,
    stream: rec.stream,
    startedAt: rec.startedAt,
    status: rec.status,
    preview: rec.preview,
    input: rec.input,
    content: rec.content,
    thinking: rec.thinking,
    tokens: rec.tokens,
    finishedAt: rec.finishedAt,
  };
}

// --- Delta flushing ---------------------------------------------------------
function flushDeltas() {
  global._liveFlushTimer = null;
  const updates = [];
  for (const [id, buf] of deltaBuf) {
    if (buf.content || buf.thinking) {
      updates.push({ id, content: buf.content, thinking: buf.thinking });
    }
  }
  deltaBuf.clear();
  if (updates.length) liveEmitter.emit("delta", { updates });
}

// --- Public API -------------------------------------------------------------
export function liveStart({ id, provider, model, connectionId, account, body, stream }) {
  if (!id || !isLiveEnabled()) return;
  const rec = {
    id,
    provider,
    model,
    connectionId,
    account,
    stream: !!stream,
    startedAt: Date.now(),
    status: "pending",
    preview: buildPreview(body),
    input: body,
    content: "",
    thinking: "",
    tokens: null,
    finishedAt: null,
  };
  liveRequests.set(id, rec);
  const timer = setTimeout(() => liveEvict(id), LIVE_TTL_MS);
  timer?.unref?.();
  evictTimers.set(id, timer);
  liveEmitter.emit("start", publicRecord(rec));
}

export function liveAppend(id, { content = "", thinking = "" } = {}) {
  const rec = liveRequests.get(id);
  if (!rec || rec.status === "done") return;
  rec.content += content;
  rec.thinking += thinking;
  rec.status = "streaming";
  let buf = deltaBuf.get(id);
  if (!buf) {
    buf = { content: "", thinking: "" };
    deltaBuf.set(id, buf);
  }
  buf.content += content;
  buf.thinking += thinking;
  if (!global._liveFlushTimer) {
    global._liveFlushTimer = setTimeout(flushDeltas, DELTA_FLUSH_MS);
    global._liveFlushTimer?.unref?.();
  }
}

export function liveFinish(id, { tokens } = {}) {
  const rec = liveRequests.get(id);
  if (!rec || rec.status === "done") return;
  rec.status = "done";
  rec.finishedAt = Date.now();
  if (tokens !== undefined) rec.tokens = tokens;
  // Drop any pending delta for this id so no stale append lands after finish;
  // the finish event carries the authoritative full content instead.
  deltaBuf.delete(id);
  // Keep the record visible; re-arm eviction to run TTL after completion.
  clearTimeout(evictTimers.get(id));
  const timer = setTimeout(() => liveEvict(id), finishEvictMs());
  timer?.unref?.();
  evictTimers.set(id, timer);
  liveEmitter.emit("finish", publicRecord(rec));
}

// Hard-remove a record from memory (TTL backstop). Client drops the card.
function liveEvict(id) {
  const rec = liveRequests.get(id);
  if (!rec) return;
  clearTimeout(evictTimers.get(id));
  evictTimers.delete(id);
  liveRequests.delete(id);
  deltaBuf.delete(id);
  liveEmitter.emit("evict", { id });
}

export function clearLiveRequests() {
  for (const timer of evictTimers.values()) clearTimeout(timer);
  evictTimers.clear();
  liveRequests.clear();
  deltaBuf.clear();
  liveEmitter.emit("clear", {});
}

export function getLiveRequests() {
  return [...liveRequests.values()]
    .map(publicRecord)
    .sort((a, b) => b.startedAt - a.startedAt);
}
