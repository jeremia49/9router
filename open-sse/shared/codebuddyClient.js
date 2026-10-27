/**
 * CodeBuddy (codebuddy.ai / .cn) client fingerprint helpers.
 *
 * Mirrors `@tencent-ai/codebuddy-code` (the official CLI) as observed against
 * https://www.codebuddy.ai — see docs/codebuddy-client-verification.md upstream.
 * The gateway correlates every model request with a conversation and a request
 * id; without them it answers `11128 conversation id missing` / `request
 * illegal`, so the ids here are functional, not cosmetic:
 *
 *   X-Conversation-ID           uuidv7 (dashed)   stable per conversation
 *   X-Root-Request-ID           uuidv7 (hex)      first request of that conversation
 *   X-Conversation-Request-ID   uuidv7 (hex)      one per upstream call
 *   X-Request-ID                uuidv7 (hex)      same as X-Conversation-Message-ID
 *   X-Conversation-Message-ID   uuidv7 (hex)      one per upstream call
 *
 * The real CLI allocates a request id per *turn* and increments
 * `extra_vars.harnessMetadata.stepIndex` per model call inside it. A proxy
 * cannot see turn boundaries (each model call is its own HTTP request), so we
 * keep the conversation stable and allocate fresh request/message ids per
 * call — unique for idempotency, correlated for caching.
 */

import crypto from "node:crypto";
import { resolveSessionId } from "../utils/sessionManager.js";

// Version of the official CLI this fingerprint mirrors. Bumping it also bumps
// the `User-Agent`, `X-IDE-Version` and `harnessMetadata.harnessVersion`.
export const CODEBUDDY_CLI_VERSION = "2.175.0";

// Conversation ids from the real client look like a uuidv7, so keep the shape.
const UUID_V7_HEX_RE = /^[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$/;
const UUID_V7_DASHED_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Conversation state (bounded, TTL-evicted): stable conversation id + root id.
const CONVERSATION_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CONVERSATIONS = 2000;
const conversations = new Map();

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of conversations) {
    if (now - entry.lastUsed > CONVERSATION_TTL_MS) conversations.delete(key);
  }
}, 10 * 60 * 1000);
if (cleanup.unref) cleanup.unref();

/** Clear cached conversation ids (tests / explicit reset). */
export function clearCodeBuddyConversations() {
  conversations.clear();
}

/**
 * uuidv7-shaped id derived from a seed (deterministic) or random.
 * The 48-bit timestamp is real time so ids look like the client's.
 */
export function uuidv7Hex(seed) {
  const bytes = seed
    ? crypto.createHash("sha256").update(String(seed)).digest().subarray(0, 16)
    : crypto.randomBytes(16);
  // 48-bit big-endian millisecond timestamp
  const ts = BigInt(Date.now());
  for (let i = 0; i < 6; i++) bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytes.toString("hex");
}

export function uuidv7Dashed(seed) {
  const hex = uuidv7Hex(seed);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeConversationId(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (UUID_V7_DASHED_RE.test(v) || UUID_V7_HEX_RE.test(v)) return v;
  return null;
}

/** Conversation seed: the client's own conversation/session id when present. */
function conversationSeed(headers, body, connectionId) {
  try {
    // Client-supplied conversation id wins (keeps an existing conversation).
    const fromHeader = headers?.["x-conversation-id"] || headers?.["conversation_id"];
    const fromBody = body?.conversation_id || body?.metadata?.conversation_id;
    const explicit = normalizeConversationId(fromHeader) || normalizeConversationId(fromBody);
    if (explicit) return { key: `id:${explicit}`, conversationId: explicit };

    const sessionId = resolveSessionId({ headers, body, connectionId, scope: "codebuddy-intl" });
    if (!sessionId) return { key: null, conversationId: null };
    return { key: `session:${connectionId || ""}:${sessionId}`, conversationId: null };
  } catch {
    return { key: null, conversationId: null };
  }
}

/**
 * Resolve (and cache) the conversation identity for one request.
 * @returns {{ conversationId: string, rootRequestId: string }}
 */
export function resolveCodeBuddyConversation({ headers, body, connectionId } = {}) {
  const { key, conversationId } = conversationSeed(headers, body, connectionId);
  if (!key) {
    const hex = uuidv7Hex();
    return { conversationId: uuidv7Dashed(hex), rootRequestId: hex };
  }

  const now = Date.now();
  const hit = conversations.get(key);
  if (hit && now - hit.lastUsed <= CONVERSATION_TTL_MS) {
    hit.lastUsed = now;
    return { conversationId: hit.conversationId, rootRequestId: hit.rootRequestId };
  }

  const rootRequestId = uuidv7Hex();
  const entry = {
    conversationId: conversationId || uuidv7Dashed(rootRequestId),
    rootRequestId,
    lastUsed: now,
  };
  if (conversations.size >= MAX_CONVERSATIONS) {
    conversations.delete(conversations.keys().next().value);
  }
  conversations.set(key, entry);
  return { conversationId: entry.conversationId, rootRequestId };
}

/** Identity headers for one upstream model call. */
export function buildCodeBuddyIdentityHeaders({ headers, body, connectionId, cliVersion = CODEBUDDY_CLI_VERSION } = {}) {
  const conversation = resolveCodeBuddyConversation({ headers, body, connectionId });
  const callId = uuidv7Hex();
  return {
    "X-Conversation-ID": conversation.conversationId,
    "X-Root-Request-ID": conversation.rootRequestId,
    "X-Conversation-Request-ID": callId,
    "X-Conversation-Message-ID": callId,
    "X-Request-ID": callId,
    "X-IDE-Version": cliVersion,
  };
}

/**
 * `extra_vars` payload the CLI attaches to every model request. `harnessStep`
 * is 0 for a fresh call; a proxy has no turn-scoped step counter.
 */
export function buildCodeBuddyExtraVars(existing, { cliVersion = CODEBUDDY_CLI_VERSION, stepIndex = 0 } = {}) {
  const harnessMetadata = JSON.stringify({
    schemaVersion: 1,
    harnessVersion: cliVersion,
    stepIndex,
    agent: { depth: 0 },
  });
  return {
    ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}),
    harnessMetadata,
    initiator: "user",
  };
}

/** `X-User-Id` the CLI reports: real uid for OAuth, `anonymous_<last8>` for raw keys. */
export function resolveCodeBuddyUserId(credentials) {
  const explicit = credentials?.providerSpecificData?.uid;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();

  // OAuth connections created before the uid existed: fall back to the JWT `sub`
  // the same way the CLI derives the account (access tokens are Tencent JWTs).
  const token = credentials?.apiKey || credentials?.accessToken || "";
  if (!credentials?.apiKey && credentials?.accessToken) {
    const payload = decodeJwtPayload(credentials.accessToken);
    if (payload && typeof payload.sub === "string" && payload.sub.trim()) return payload.sub.trim();
    return null;
  }
  if (credentials?.apiKey) return `anonymous_${token.slice(-8)}`;
  return null;
}

function decodeJwtPayload(jwt) {
  try {
    if (typeof jwt !== "string") return null;
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Default User-Agent of `@tencent-ai/codebuddy-code` against codebuddy.ai. */
export function codeBuddyUserAgent(cliVersion = CODEBUDDY_CLI_VERSION) {
  return `CLI/${cliVersion} CodeBuddy/${cliVersion}`;
}
