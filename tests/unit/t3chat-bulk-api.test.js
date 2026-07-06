import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseT3ChatBulkCredentials } from "../../src/lib/t3chat/bulkCredentials.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;

function jsonRequest(url, body) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("T3Chat bulk credential parser", () => {
  it("parses valid lines and reports invalid lines", () => {
    const result = parseT3ChatBulkCredentials("cookie-a | convex-a\n\nmissing\n | convex\ncookie-b | convex-b");
    expect(result.valid).toEqual([
      { line: 1, name: "T3Chat 1", cookies: "cookie-a", convexSessionId: "convex-a" },
      { line: 5, name: "T3Chat 5", cookies: "cookie-b", convexSessionId: "convex-b" },
    ]);
    expect(result.invalid).toEqual([
      { line: 3, reason: "Missing | delimiter" },
      { line: 4, reason: "Cookies are required" },
    ]);
  });

  it("splits only on the first delimiter and validates convexSessionId", () => {
    const result = parseT3ChatBulkCredentials("a=b|c=d | convex\ncookie | ");
    expect(result.valid).toEqual([
      { line: 1, name: "T3Chat 1", cookies: "a=b", convexSessionId: "c=d | convex" },
    ]);
    expect(result.invalid).toEqual([{ line: 2, reason: "convexSessionId is required" }]);
  });
});

describe("T3Chat provider APIs", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-t3chat-api-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    vi.doMock("next/server", () => ({
      NextResponse: {
        json(body, init = {}) {
          return new Response(JSON.stringify(body), {
            status: init.status || 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock("next/server");
    vi.resetModules();
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("creates a single T3Chat connection without apiKey", async () => {
    const { POST } = await import("../../src/app/api/providers/route.js");
    const { getProviderConnections } = await import("../../src/models/index.js");

    const res = await POST(jsonRequest("https://9router.local/api/providers", {
      provider: "t3chat",
      name: "T3 account",
      providerSpecificData: { cookies: "cookie-a", convexSessionId: "convex-a" },
    }));
    const body = await res.json();
    const stored = await getProviderConnections({ provider: "t3chat" });

    expect(res.status).toBe(201);
    expect(body.connection.apiKey).toBeUndefined();
    expect(stored[0]).toMatchObject({
      provider: "t3chat",
      authType: "cookie",
      apiKey: "",
      providerSpecificData: { cookies: "cookie-a", convexSessionId: "convex-a" },
    });
  });

  it("bulk imports valid T3Chat accounts and reports invalid rows", async () => {
    const { POST } = await import("../../src/app/api/providers/t3chat/bulk/route.js");
    const { getProviderConnections } = await import("../../src/models/index.js");

    const res = await POST(jsonRequest("https://9router.local/api/providers/t3chat/bulk", {
      text: "cookie-a | convex-a\ninvalid\ncookie-b | convex-b",
    }));
    const body = await res.json();
    const stored = await getProviderConnections({ provider: "t3chat" });
    const imported = stored.filter((connection) => ["T3Chat 1", "T3Chat 3"].includes(connection.name));

    expect(res.status).toBe(200);
    expect(body.success).toBe(2);
    expect(body.failed).toBe(1);
    expect(body.invalid).toEqual([{ line: 2, reason: "Missing | delimiter" }]);
    expect(imported).toHaveLength(2);
    expect(imported.map((connection) => connection.providerSpecificData.convexSessionId).sort()).toEqual(["convex-a", "convex-b"]);
  });
});
