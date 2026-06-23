import { describe, it, expect, vi, beforeEach } from "vitest";

const getSettingsMock = vi.fn();
const getProviderConnectionsMock = vi.fn();
const updateProviderConnectionMock = vi.fn();

vi.mock("@/lib/localDb", () => ({
  getSettings: (...args) => getSettingsMock(...args),
  getProviderConnections: (...args) => getProviderConnectionsMock(...args),
  updateProviderConnection: (...args) => updateProviderConnectionMock(...args),
  validateApiKey: vi.fn(),
}));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

beforeEach(() => {
  getSettingsMock.mockReset();
  getProviderConnectionsMock.mockReset();
  updateProviderConnectionMock.mockReset();
});

describe("provider keepUnlockedOnFailure", () => {
  it("does not create a model lock when the provider opts out of failure locking", async () => {
    getSettingsMock.mockResolvedValue({ providerStrategies: { openai: { keepUnlockedOnFailure: true } } });

    const result = await markAccountUnavailable("conn-1", 429, "rate limit", "openai", "gpt-4o");

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(getProviderConnectionsMock).not.toHaveBeenCalled();
    expect(updateProviderConnectionMock).not.toHaveBeenCalled();
  });

  it("keeps the existing model lock behavior by default", async () => {
    getSettingsMock.mockResolvedValue({ providerStrategies: {} });
    getProviderConnectionsMock.mockResolvedValue([{ id: "conn-1", backoffLevel: 0 }]);

    const result = await markAccountUnavailable("conn-1", 429, "rate limit", "openai", "gpt-4o");

    expect(result.shouldFallback).toBe(true);
    expect(updateProviderConnectionMock).toHaveBeenCalledTimes(1);
    const [, update] = updateProviderConnectionMock.mock.calls[0];
    expect(update).toHaveProperty("modelLock_gpt-4o");
    expect(update.testStatus).toBe("unavailable");
  });
});
