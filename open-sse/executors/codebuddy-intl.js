import { DefaultExecutor } from "./default.js";
import {
  CODEBUDDY_CLI_VERSION,
  buildCodeBuddyExtraVars,
  buildCodeBuddyIdentityHeaders,
  codeBuddyUserAgent,
  resolveCodeBuddyUserId,
} from "../shared/codebuddyClient.js";

/**
 * CodeBuddyIntlExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Mirrors the official `@tencent-ai/codebuddy-code` CLI on the codebuddy.ai
 * gateway (see docs/codebuddy-client-verification.md). The gateway is
 * OpenAI-compatible but stricter than a plain OpenAI endpoint:
 *
 *  - non-stream requests are rejected, so `stream` is always forced true;
 *  - `messages[0]` MUST be a system message (otherwise `400 first message is
 *    not system prompt`) — we keep the caller's system prompt and only
 *    substitute agent-identity prompts, which the gateway's content filter
 *    rejects; a neutral one is prepended when the caller sends none;
 *  - every call carries conversation/request ids (`X-Conversation-ID`,
 *    `X-Conversation-Request-ID`, `X-Request-ID`, `X-Root-Request-ID`, …);
 *    without them the gateway answers `11128 conversation id missing` /
 *    `request illegal`;
 *  - `extra_vars.harnessMetadata` identifies the harness, `stream_options`
 *    asks for the usage frame, and reasoning only surfaces when the request
 *    carries the CLI's OpenAI-style `reasoning_effort` + `reasoning_summary`.
 */
export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  // Neutral system prompt used when the caller sends none, and as the
  // replacement for agent-identity prompts the gateway's filter rejects.
  static NEUTRAL_SYSTEM_PROMPT = "You are CodeBuddy Code, an interactive CLI tool that helps users with software engineering tasks.";

  // Agent/IDE identity prompts the gateway flags as sensitive. Same heuristic as
  // the CN executor, plus the CLI's own banner so we don't leak a second
  // identity into the neutral prompt.
  static AGENT_PROMPT_RE = /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody|codebuddy)|you are an? (?:ai )?(?:coding |code )?agent|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|claude.?code.+issues|give feedback.+claude.?code|orchestration capabilities|OhMyOpenCode|<agent-identity>|<Role>|<Behavior_Instructions>/i;

  buildHeaders(credentials, stream = true, url, model, body = null) {
    const headers = super.buildHeaders(credentials, stream, url, model, body);

    // Identity headers the gateway correlates requests with. `credentials.email`
    // is used as the connection scope so two accounts never share a conversation.
    Object.assign(headers, buildCodeBuddyIdentityHeaders({
      headers: credentials?.rawHeaders,
      body,
      connectionId: credentials?.connectionId || credentials?.email,
      cliVersion: CODEBUDDY_CLI_VERSION,
    }));

    headers["X-Agent-Type"] = "main";
    headers["X-Agent-Intent"] = "craft";
    headers["X-Agent-Runtime"] = "other";
    headers["X-Agent-Purpose"] = "conversation";
    // "false" = model optimization active (the CLI's own default for non-enterprise).
    if (!headers["X-Private-Data"]) headers["X-Private-Data"] = "false";

    // Version-derived identity stays in one place: bump CODEBUDDY_CLI_VERSION and
    // the UA/IDE headers/harnessVersion all move together.
    headers["User-Agent"] = codeBuddyUserAgent(CODEBUDDY_CLI_VERSION);
    headers["X-IDE-Type"] = "CLI";
    headers["X-IDE-Name"] = "CLI";
    headers["X-IDE-Version"] = CODEBUDDY_CLI_VERSION;
    headers["x-requested-with"] = "XMLHttpRequest";
    headers["x-codebuddy-request"] = "1";

    // API-key accounts authenticate with both headers on the real client.
    const apiKey = credentials?.apiKey;
    if (apiKey && !credentials?.accessToken && !headers["X-API-Key"]) headers["X-API-Key"] = apiKey;

    const userId = resolveCodeBuddyUserId(credentials);
    if (userId && !headers["X-User-Id"]) headers["X-User-Id"] = userId;

    // The CLI streams with `Accept: application/json` (response type is driven by
    // body.stream), so mirror it instead of advertising text/event-stream.
    headers["Accept"] = "application/json";
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    this.normalizeMessages(transformed);

    // Usage frame for the SSE stream (the CLI always asks for it).
    if (!transformed.stream_options || typeof transformed.stream_options !== "object") {
      transformed.stream_options = { include_usage: true };
    } else if (transformed.stream_options.include_usage === undefined) {
      transformed.stream_options.include_usage = true;
    }

    // Harness envelope: identifies 9router as a CodeBuddy harness and carries the
    // per-call step index the gateway expects inside extra_vars.
    transformed.extra_vars = buildCodeBuddyExtraVars(transformed.extra_vars, {
      cliVersion: CODEBUDDY_CLI_VERSION,
    });

    // Prompt-cache retention the CLI latches on every request ("long" = 1h).
    if (transformed.cache_retention === undefined) transformed.cache_retention = "long";

    return transformed;
  }

  /**
   * Enforce the gateway's message contract while preserving the caller's prompt:
   *  - `messages[0]` must be a system message;
   *  - agent-identity system prompts are replaced (content filter);
   *  - user string content becomes typed text blocks (the CLI's wire shape).
   */
  normalizeMessages(transformed) {
    if (!Array.isArray(transformed.messages) || transformed.messages.length === 0) {
      transformed.messages = [{ role: "system", content: CodeBuddyIntlExecutor.NEUTRAL_SYSTEM_PROMPT }];
      return;
    }

    const neutral = CodeBuddyIntlExecutor.NEUTRAL_SYSTEM_PROMPT;
    const agentRe = CodeBuddyIntlExecutor.AGENT_PROMPT_RE;
    const flatten = (content) =>
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((b) => (b && typeof b.text === "string" ? b.text : "")).join("\n")
          : "";

    const messages = [];
    for (const message of transformed.messages) {
      if (!message || typeof message !== "object") continue;
      if (message.role === "developer") {
        messages.push({ ...message, role: "system" });
        continue;
      }
      messages.push({ ...message });
    }

    // Keep the caller's system prompt unless it is an agent identity the filter blocks.
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (message.role !== "system") continue;
      const text = flatten(message.content);
      if (!text) continue;
      if (text.trim() === neutral) continue;
      if (!(agentRe.test(text) || text.length > 4000)) continue;
      messages[i] = typeof message.content === "string"
        ? { ...message, content: neutral }
        : { ...message, content: [{ type: "text", text: neutral }] };
    }

    // Gateway requires a leading system message.
    if (messages[0].role !== "system") {
      messages.unshift({ role: "system", content: neutral });
    }

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (message.role === "user" && typeof message.content === "string") {
        messages[i] = { ...message, content: [{ type: "text", text: message.content }] };
      }
    }

    transformed.messages = messages;
  }

  parseError(response, bodyText) {
    if (bodyText) {
      try {
        const data = JSON.parse(bodyText);
        const msg = data?.msg || data?.message || data?.error?.message || "";
        if (data?.code === 6004 || /超出频率限制|frequency limit|限额/i.test(msg)) {
          let resetsAtMs = null;
          const match = msg.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*UTC\+?([0-9:]+))?/i);
          if (match) {
            const dp = match[1];
            const tp = match[2];
            const tz = match[3]
              ? (match[3].includes(":") ? (match[3].startsWith("+") ? match[3] : `+${match[3]}`) : `+${match[3].padStart(2, "0")}:00`)
              : "+08:00";
            const dt = new Date(`${dp}T${tp}${tz}`);
            if (!isNaN(dt.getTime())) resetsAtMs = dt.getTime();
          }
          return {
            status: 429,
            message: msg || "CodeBuddy frequency limit (6004)",
            resetsAtMs,
          };
        }
      } catch {}
    }
    return super.parseError(response, bodyText);
  }
}

export default CodeBuddyIntlExecutor;
