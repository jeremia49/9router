// CodeBuddy international (codebuddy.ai) — the official CLI's gateway.
//
// Wire behaviour mirrors `@tencent-ai/codebuddy-code` (the `codebuddy` CLI)
// talking to https://www.codebuddy.ai. Everything here — UA, IDE headers,
// `platform=CLI` on the OAuth endpoints, the model catalog — comes from that
// client, NOT from the older IDE plugin (which used `platform=ide` and an
// `IDE/2.x` User-Agent and is what this provider used to impersonate).
//
// `X-Conversation-*` / `X-Request-ID` / `X-Agent-*` / `extra_vars` are added per
// request by CodeBuddyIntlExecutor (see open-sse/shared/codebuddyClient.js).
export default {
  id: "codebuddy-intl",
  alias: "cbai",
  uiAlias: "cbai",
  hidden: false,
  priority: 90,
  display: {
    name: "CodeBuddy",
    icon: "smart_toy",
    color: "#006EFF",
    website: "https://www.codebuddy.ai",
    notice: {
      signupUrl: "https://www.codebuddy.ai",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    // Chat gateway is OpenAI-compatible SSE on /v2/chat/completions.
    baseUrl: "https://www.codebuddy.ai/v2/chat/completions",
    forceStream: true,
    // CodeBuddy is a unified OpenAI-compatible gateway: reasoning rides
    // OpenAI-style reasoning_effort (not a vendor-native thinking shape).
    thinkingFormat: "openai",
    headers: {
      // CLI/2.175.0 CodeBuddy/2.175.0 — the default UA of @tencent-ai/codebuddy-code.
      "User-Agent": "CLI/2.175.0 CodeBuddy/2.175.0",
      "X-Product": "SaaS",
      "X-IDE-Type": "CLI",
      "X-IDE-Name": "CLI",
      "X-IDE-Version": "2.175.0",
      "x-requested-with": "XMLHttpRequest",
      "x-codebuddy-request": "1",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      // Channel check requires the plugin's request/conversation ids — without
      // them upstream rejects with 400 / 11128 "request illegal".
      hooks: ["codebuddyHeaders"],
    },
    // Quota endpoint: the same Tencent billing payload as CN
    // (data.Response.Data.Accounts[]). The path exists on codebuddy.ai — it
    // answers 401 (APISIX) when unauthenticated rather than 404, i.e. the route
    // is live — and the CLI's own quota view reads it through the same gateway.
    usage: {
      url: "https://www.codebuddy.ai/v2/billing/meter/get-user-resource",
    },
  },
  // Catalog mirrors the `models[]` payload the gateway publishes to the CLI
  // (product.json, snapshot 2026-10-24): id = wire id, maxInputTokens ->
  // contextWindow, maxOutputTokens -> maxOutput, supportsImages -> vision.
  // Meta-models ("Auto"/"Fast"/...) route server-side to the same catalog and
  // are what the CLI actually sends by default.
  models: [
    { id: "default-model", name: "Auto" },
    { id: "fast-model", name: "Fast" },
    { id: "balanced-model", name: "Balanced" },
    { id: "primary-model", name: "Primary" },
    { id: "deep-model", name: "Deep" },
    { id: "glm-5.3", name: "GLM-5.3" },
    { id: "glm-5.3-flash", name: "GLM-5.3-Flash" },
    { id: "glm-5.2", name: "GLM-5.2" },
    { id: "kimi-k3", name: "Kimi-K3" },
    { id: "kimi-k2.8-preview", name: "Kimi-K2.8-Preview" },
    { id: "kimi-k2.6", name: "Kimi-K2.6" },
    { id: "deepseek-v4.1-flash", name: "DeepSeek-V4.1-Flash" },
    // Regional lane of the same model (priced differently on the server).
    { id: "deepseek-v4.1-flash-sg", name: "DeepSeek-V4.1-Flash (SG)" },
    { id: "hy3", name: "Hy3" },
    { id: "hy4-preview", name: "Hy4-Preview" },
    { id: "gemini-3.5-flash", name: "Gemini-3.5-Flash" },
    { id: "gpt-6-astra", name: "GPT-6-Astra" },
    { id: "gpt-5.6-sol", name: "GPT-5.6-Sol" },
    { id: "gpt-5.6-terra", name: "GPT-5.6-Terra" },
    { id: "gpt-5.6-luna", name: "GPT-5.6-Luna" },
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "gpt-5.4", name: "GPT-5.4" },
  ],
  oauth: {
    baseUrl: "https://www.codebuddy.ai",
    stateUrl: "https://www.codebuddy.ai/v2/plugin/auth/state",
    tokenUrl: "https://www.codebuddy.ai/v2/plugin/auth/token",
    refreshUrl: "https://www.codebuddy.ai/v2/plugin/auth/token/refresh",
    accountUrl: "https://www.codebuddy.ai/v2/plugin/account",
    // The CLI logs in with platform=CLI; the IDE plugin used platform=ide.
    userAgent: "CLI/2.175.0 CodeBuddy/2.175.0",
    platform: "CLI",
    pollInterval: 5000,
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
