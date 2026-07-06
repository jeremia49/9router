import { NextResponse } from "next/server";

import { fetchT3ChatQuota } from "@/lib/t3chat/quota";
import { getProviderConnectionById, getProviderConnections, updateProviderConnection } from "@/models";

export const dynamic = "force-dynamic";

async function refreshConnection(connection) {
  const cookies = connection?.providerSpecificData?.cookies;
  if (!cookies) {
    const quota = {
      status: "error",
      lastCheckedAt: Date.now(),
      lastError: "T3Chat cookies are missing",
    };
    return { connectionId: connection?.id, quota };
  }

  const quota = await fetchT3ChatQuota({ cookies });
  await updateProviderConnection(connection.id, {
    providerSpecificData: {
      ...(connection.providerSpecificData || {}),
      t3chatQuota: quota,
    },
  });
  return { connectionId: connection.id, quota };
}

export async function POST(request) {
  try {
    const body = await request.json();
    let connections = [];

    if (body.connectionId) {
      const connection = await getProviderConnectionById(body.connectionId);
      if (!connection || connection.provider !== "t3chat") {
        return NextResponse.json({ error: "T3Chat connection not found" }, { status: 404 });
      }
      connections = [connection];
    } else if (body.all === true) {
      connections = await getProviderConnections({ provider: "t3chat" });
    } else {
      return NextResponse.json({ error: "connectionId or all:true is required" }, { status: 400 });
    }

    const results = [];
    for (const connection of connections) {
      results.push(await refreshConnection(connection));
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.log("Error refreshing T3Chat quota:", error);
    return NextResponse.json({ error: "Failed to refresh T3Chat quota" }, { status: 500 });
  }
}
