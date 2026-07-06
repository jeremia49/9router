import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { AI_PROVIDERS, WEB_COOKIE_PROVIDERS } from "../../src/shared/constants/providers.js";

describe("T3Chat provider registry", () => {
  const entry = REGISTRY.find((provider) => provider.id === "t3chat");

  it("registers T3Chat as a web-cookie provider with custom credentials", () => {
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      id: "t3chat",
      alias: "t3chat",
      category: "webCookie",
      authType: "cookie",
      hasProviderSpecificData: true,
    });
    expect(entry.display.name).toBe("T3Chat");
  });

  it("builds runtime provider and UI provider maps", () => {
    expect(PROVIDERS.t3chat).toMatchObject({
      baseUrl: "https://t3.chat/api/chat",
      format: "openai",
    });
    expect(AI_PROVIDERS.t3chat.name).toBe("T3Chat");
    expect(WEB_COOKIE_PROVIDERS.t3chat.authType).toBe("cookie");
  });

  it("exposes seed text models", () => {
    const ids = (PROVIDER_MODELS.t3chat || []).map((model) => model.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain("gpt-4o-mini");
  });

  it("keeps registry ids unique", () => {
    const ids = REGISTRY.map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
