// CodeBuddy.ai (codebuddy-intl) wire fidelity.
//
// The provider used to impersonate the OLD IDE plugin (IDE/2.x UA, platform=ide)
// and, worse, replaced the caller's whole message list with a single
// "You are CodeBuddy Code." system message — dropping the caller's system prompt
// and history. It also never sent the ids the gateway correlates requests with,
// which is exactly the `11128 conversation id missing` / `request illegal`
// failure mode seen in #5024.
//
// These tests pin the official CLI (`@tencent-ai/codebuddy-code`) shape instead:
//   - messages[0] is a system message, but the caller's prompt is preserved;
//   - user string content becomes typed text blocks;
//   - conversation/request ids are uuidv7-shaped and consistent per call;
//   - extra_vars.harnessMetadata, stream_options.include_usage, cache_retention;
//   - streaming is forced, reasoning params stay opt-in.
import { describe, expect, it, beforeEach } from "vitest";

import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";
import {
  buildCodeBuddyExtraVars,
  clearCodeBuddyConversations,
  resolveCodeBuddyUserId,
  uuidv7Hex,
} from "../../open-sse/shared/codebuddyClient.js";
import { PROVIDERS, PROVIDER_MODELS, PROVIDER_OAUTH } from "../../open-sse/providers/index.js";
import { BACKOFF_CONFIG } from "../../open-sse/config/errorConfig.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

const UUID_V7_HEX = /^[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$/;
const UUID_V7_DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const exec = new CodeBuddyIntlExecutor();
const transform = (body, credentials = {}) => exec.transformRequest("glm-5.3", body, false, credentials); 

beforeEach(() => clearCodeBuddyConversations());

describe("codebuddy-intl transformRequest keeps the caller's prompt", () => {
  it("preserves a legitimate system prompt instead of replacing it", () => {
    const out = transform({
      messages: [
        { role: "system", content: "You are a helpful assistant. Answer in Indonesian." },
        { role: "user", content: "halo" },
      ],
    });
    expect(out.messages[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant. Answer in Indonesian.",
    });
    expect(out.messages).toHaveLength(2);
  });

  it("keeps multi-turn history (assistant + tool messages survive)", () => {
    const out = transform({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "one" },
        { role: "assistant", content: "two" },
        { role: "user", content: "three" },
      ],
    });
    expect(out.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(out.messages[2].content).toBe("two");
  });

  it("prepends a neutral system message when the caller sends none", () => {
    const out = transform({ messages: [{ role: "user", content: "hi" }] });
    expect(out.messages[0].role).toBe("system");
    expect(typeof out.messages[0].content).toBe("string");
    expect(out.messages).toHaveLength(2);
  });

  it("replaces agent-identity prompts the gateway filter blocks", () => {
    const out = transform({
      messages: [
        { role: "system", content: "You are Claude Code, Anthropic's official CLI for Claude." },
        { role: "user", content: "hi" },
      ],
    });
    expect(out.messages[0].content).toBe(CodeBuddyIntlExecutor.NEUTRAL_SYSTEM_PROMPT);
  });

  it("maps the developer role onto system (gateway only knows system)", () => {
    const out = transform({
      messages: [
        { role: "developer", content: "be terse" },
        { role: "user", content: "hi" },
      ],
    });
    expect(out.messages[0]).toEqual({ role: "system", content: "be terse" });
  });

  it("sends user content as typed text blocks (CLI wire shape)", () => {
    const out = transform({ messages: [{ role: "user", content: "hi" }] });
    expect(out.messages.at(-1).content).toEqual([{ type: "text", text: "hi" }]);
  });
});

describe("codebuddy-intl request envelope", () => {
  it("forces streaming and asks for the usage frame", () => {
    const out = transform({ messages: [{ role: "user", content: "hi" }], stream: false });
    expect(out.stream).toBe(true);
    expect(out.stream_options).toEqual({ include_usage: true });
  });

  it("keeps an existing stream_options object, filling include_usage", () => {
    const out = transform({
      messages: [{ role: "user", content: "hi" }],
      stream_options: { some_flag: 1 },
    });
    expect(out.stream_options).toEqual({ some_flag: 1, include_usage: true });
  });

  it("latches cache_retention=long and keeps a client value", () => {
    expect(transform({ messages: [{ role: "user", content: "hi" }] }).cache_retention).toBe("long");
    expect(transform({ messages: [{ role: "user", content: "hi" }], cache_retention: "short" }).cache_retention).toBe("short");
  });

  it("attaches extra_vars.harnessMetadata + initiator and preserves client extra_vars", () => {
    const out = transform({
      messages: [{ role: "user", content: "hi" }],
      extra_vars: { initiator: "client", keep: "me" },
    });
    expect(out.extra_vars.initiator).toBe("user");
    expect(out.extra_vars.keep).toBe("me");
    const meta = JSON.parse(out.extra_vars.harnessMetadata);
    expect(meta).toEqual({
      schemaVersion: 1,
      harnessVersion: "2.175.0",
      stepIndex: 0,
      agent: { depth: 0 },
    });
  });

  it("leaves reasoning opt-in (no forced reasoning on a plain request)", () => {
    const plain = transform({ messages: [{ role: "user", content: "hi" }] });
    expect(plain.reasoning_effort).toBeUndefined();
    expect(plain.reasoning_summary).toBeUndefined();

    const asked = transform({ messages: [{ role: "user", content: "hi" }], reasoning_effort: "high" });
    expect(asked.reasoning_effort).toBe("high");
    expect(asked.reasoning_summary).toBe("auto");

    const off = transform({ messages: [{ role: "user", content: "hi" }], reasoning_effort: "none" });
    expect(off.reasoning_effort).toBeUndefined();
    expect(off.reasoning_summary).toBeUndefined();
  });
});

describe("codebuddy-intl identity headers", () => {
  const headers = (creds = {}) =>
    exec.buildHeaders(creds, true, "https://www.codebuddy.ai/v2/chat/completions", "glm-5.3", {});

  it("sends CLI identity, not the old IDE plugin identity", () => {
    const h = headers({ accessToken: "tok" });
    expect(h["User-Agent"]).toBe("CLI/2.175.0 CodeBuddy/2.175.0");
    expect(h["X-IDE-Type"]).toBe("CLI");
    expect(h["X-IDE-Name"]).toBe("CLI");
    expect(h["X-IDE-Version"]).toBe("2.175.0");
    expect(h["X-Product"]).toBe("SaaS");
    expect(h["User-Agent"]).not.toMatch(/^IDE\//);
  });

  it("sends uuidv7-shaped conversation/request ids that stay consistent inside a call", () => {
    const h = headers({ accessToken: "tok" });
    expect(h["X-Conversation-ID"]).toMatch(UUID_V7_DASHED);
    expect(h["X-Root-Request-ID"]).toMatch(UUID_V7_HEX);
    expect(h["X-Conversation-Request-ID"]).toMatch(UUID_V7_HEX);
    expect(h["X-Request-ID"]).toBe(h["X-Conversation-Message-ID"]);
    expect(h["X-Request-ID"]).toBe(h["X-Conversation-Request-ID"]);
  });

  it("keeps the conversation stable across calls and rotates the request id", () => {
    const creds = { accessToken: "tok", connectionId: "conn-a" };
    const first = headers(creds);
    const second = headers(creds);
    expect(second["X-Conversation-ID"]).toBe(first["X-Conversation-ID"]);
    expect(second["X-Root-Request-ID"]).toBe(first["X-Root-Request-ID"]);
    expect(second["X-Request-ID"]).not.toBe(first["X-Request-ID"]);
  });

  it("scopes conversations per connection", () => {
    const a = headers({ accessToken: "tok", connectionId: "conn-a" });
    const b = headers({ accessToken: "tok", connectionId: "conn-b" });
    expect(a["X-Conversation-ID"]).not.toBe(b["X-Conversation-ID"]);
  });

  it("honours a client-supplied X-Conversation-ID", () => {
    const conversationId = "01890a5d-ac96-774b-bcce-b302099a8057";
    const h = exec.buildHeaders(
      { accessToken: "tok", rawHeaders: { "x-conversation-id": conversationId } },
      true, undefined, "glm-5.3", {},
    );
    expect(h["X-Conversation-ID"]).toBe(conversationId);
  });

  it("sends agent/product headers the CLI sends", () => {
    const h = headers({ accessToken: "tok" });
    expect(h["X-Agent-Type"]).toBe("main");
    expect(h["X-Agent-Intent"]).toBe("craft");
    expect(h["X-Agent-Runtime"]).toBe("other");
    expect(h["X-Agent-Purpose"]).toBe("conversation");
    expect(h["X-Private-Data"]).toBe("false");
    expect(h["x-codebuddy-request"]).toBe("1");
    expect(h["x-requested-with"]).toBe("XMLHttpRequest");
    expect(h.Accept).toBe("application/json");
  });

  it("derives X-User-Id from the OAuth account, or anonymous_<last8> for API keys", () => {
    expect(headers({ accessToken: "tok", providerSpecificData: { uid: "u-42" } })["X-User-Id"]).toBe("u-42");
    expect(headers({ apiKey: "sk-test-abcdefgh" })["X-User-Id"]).toBe("anonymous_abcdefgh");
    // API-key accounts authenticate with both headers on the real client.
    const keyed = headers({ apiKey: "sk-test-abcdefgh" });
    expect(keyed["X-API-Key"]).toBe("sk-test-abcdefgh");
    expect(keyed.Authorization).toBe("Bearer sk-test-abcdefgh");
  });

  it("falls back to the JWT sub for OAuth connections created before uid existed", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "u-from-jwt" })).toString("base64url");
    expect(resolveCodeBuddyUserId({ accessToken: `h.${payload}.s` })).toBe("u-from-jwt");
  });
});

describe("codebuddy-intl provider config", () => {
  it("points at the CLI gateway with CLI identity headers", () => {
    const t = PROVIDERS["codebuddy-intl"];
    expect(t.baseUrl).toBe("https://www.codebuddy.ai/v2/chat/completions");
    expect(t.forceStream).toBe(true);
    expect(t.thinkingFormat).toBe("openai");
    expect(t.headers["User-Agent"]).toBe("CLI/2.175.0 CodeBuddy/2.175.0");
    expect(t.headers["X-IDE-Type"]).toBe("CLI");
    expect(t.usage.url).toBe("https://www.codebuddy.ai/v2/billing/meter/get-user-resource");
  });

  it("uses the CLI login flow (platform=CLI) on codebuddy.ai", () => {
    const oauth = PROVIDER_OAUTH["codebuddy-intl"];
    expect(oauth.platform).toBe("CLI");
    expect(oauth.stateUrl).toBe("https://www.codebuddy.ai/v2/plugin/auth/state");
    expect(oauth.tokenUrl).toBe("https://www.codebuddy.ai/v2/plugin/auth/token");
    expect(oauth.refreshUrl).toBe("https://www.codebuddy.ai/v2/plugin/auth/token/refresh");
    expect(oauth.userAgent).toBe("CLI/2.175.0 CodeBuddy/2.175.0");
  });

  it("publishes the gateway's model catalog, not the retired one", () => {
    const ids = (PROVIDER_MODELS["cbai"] || []).map((m) => m.id);
    for (const id of ["glm-5.3", "glm-5.2", "kimi-k3", "kimi-k2.8-preview", "deepseek-v4.1-flash", "default-model"]) {
      expect(ids).toContain(id);
    }
    for (const retired of ["glm-5.1", "glm-4.7", "minimax-m3", "kimi-k2.7", "hy3-preview", "deepseek-v3-2-volc"]) {
      expect(ids).not.toContain(retired);
    }
  });

  it("declares capabilities from the server's model table", () => {
    const glm = getCapabilitiesForModel("codebuddy-intl", "glm-5.3");
    expect(glm.reasoning).toBe(true);
    expect(glm.thinkingFormat).toBe("openai");
    expect(glm.contextWindow).toBe(1000000);
    expect(glm.maxOutput).toBe(48000);

    const kimi = getCapabilitiesForModel("codebuddy-intl", "kimi-k2.8-preview");
    // contextWindow is the server's defaultLength (300k), not maxInputTokens.
    expect(kimi.contextWindow).toBe(300000);
  });

  it("exposes per-model reasoning levels from supportedEfforts", () => {
    expect(getThinkingLevels("codebuddy-intl", "glm-5.2")).toEqual(["high", "xhigh"]);
    expect(getThinkingLevels("codebuddy-intl", "deepseek-v4.1-flash")).toEqual(["low", "high", "max"]);
    expect(getThinkingLevels("codebuddy-intl", "hy4-preview")).toEqual(["high"]);
    // thinkingCanDisable:false drops "none" for always-thinking models.
    expect(getThinkingLevels("codebuddy-intl", "gpt-5.5")).not.toContain("none");
  });
});

describe("codebuddy-intl error handling", () => {
  it("turns the 6004 frequency limit into a 429 with resetsAtMs", () => {
    const parsed = exec.parseError(
      { status: 200 },
      JSON.stringify({ code: 6004, msg: "frequency limit exceeded, retry after 2026-09-28 12:00:00 UTC+0" }),
    );
    expect(parsed.status).toBe(429);
    expect(parsed.resetsAtMs).toBe(new Date("2026-09-28T12:00:00+00:00").getTime());
  });

  it("still backs off (not fail-fast) on intl block messages", () => {
    for (const msg of ["11128:request illegal", "conversation id missing"]) {
      expect(checkFallbackError(400, { code: 11128, msg }, 0, "codebuddy-intl")).toEqual({
        shouldFallback: true, cooldownMs: BACKOFF_CONFIG.base, newBackoffLevel: 1,
      });
    }
  });
});

describe("codebuddyClient helpers", () => {
  it("uuidv7Hex is version 7, RFC-4122 variant", () => {
    expect(uuidv7Hex()).toMatch(UUID_V7_HEX);
  });

  it("buildCodeBuddyExtraVars serialises the harness envelope", () => {
    const meta = JSON.parse(buildCodeBuddyExtraVars(null).harnessMetadata);
    expect(meta.schemaVersion).toBe(1);
    expect(meta.agent).toEqual({ depth: 0 });
    expect(buildCodeBuddyExtraVars(null).initiator).toBe("user");
  });
});
