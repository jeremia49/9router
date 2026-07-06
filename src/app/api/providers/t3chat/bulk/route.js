import { NextResponse } from "next/server";

import { createProviderConnection } from "@/models";
import { parseT3ChatBulkCredentials } from "@/lib/t3chat/bulkCredentials";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const parsed = parseT3ChatBulkCredentials(body.text || "");
    const createErrors = [];
    let success = 0;

    for (const item of parsed.valid) {
      try {
        await createProviderConnection({
          provider: "t3chat",
          authType: "cookie",
          name: item.name,
          apiKey: "",
          priority: 1,
          globalPriority: null,
          defaultModel: null,
          providerSpecificData: {
            cookies: item.cookies,
            convexSessionId: item.convexSessionId,
          },
          isActive: true,
          testStatus: "unknown",
        });
        success++;
      } catch (error) {
        createErrors.push({ line: item.line, reason: error.message || "Failed to create connection" });
      }
    }

    const invalid = [...parsed.invalid, ...createErrors];
    return NextResponse.json({ success, failed: invalid.length, invalid });
  } catch (error) {
    console.log("Error bulk importing T3Chat accounts:", error);
    return NextResponse.json({ error: "Failed to bulk import T3Chat accounts" }, { status: 500 });
  }
}
