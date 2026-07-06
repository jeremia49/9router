import { T3ChatTransport } from "../../../open-sse/executors/t3chatTransport.js";

export const T3CHAT_CUSTOMER_DATA_URL = "https://t3.chat/api/trpc/getCustomerData?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22sessionId%22%3Anull%7D%2C%22meta%22%3A%7B%22values%22%3A%7B%22sessionId%22%3A%5B%22undefined%22%5D%7D%7D%7D%7D";
export const T3CHAT_SUBSCRIPTION_DATA_URL = "https://t3.chat/api/trpc/getSubscriptionData?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%2C%22meta%22%3A%7B%22values%22%3A%5B%22undefined%22%5D%7D%7D%7D";

function collectCandidates(value, candidates) {
  if (!value || typeof value !== "object") return;
  if (value.result?.data?.json && typeof value.result.data.json === "object") {
    candidates.push(value.result.data.json);
  }
  if (value.json && typeof value.json === "object") {
    candidates.push(value.json);
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectCandidates(item, candidates));
  }
}

export function extractT3ChatTrpcResult(body) {
  const candidates = [];

  try {
    collectCandidates(JSON.parse(body), candidates);
  } catch { }

  for (const line of String(body || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      collectCandidates(JSON.parse(trimmed), candidates);
    } catch { }
  }

  return candidates.find((item) => item && typeof item === "object") || null;
}

function number(value) {
  return typeof value === "number" ? value : 0;
}

function string(value) {
  return typeof value === "string" ? value : "";
}

function bool(value) {
  return typeof value === "boolean" ? value : false;
}

function nullableNumber(value) {
  return typeof value === "number" ? value : null;
}

export function parseT3ChatCustomerData(data = {}) {
  return {
    subTier: string(data.subTier),
    balance: number(data.balance),
    lifetimeBalance: number(data.lifetimeBalance),
    isBalanceReliable: bool(data.isBalanceReliable),
    usageBand: string(data.usageBand),
    billingProvider: string(data.billingProvider),
    usageFourHourPercentage: number(data.usageFourHourPercentage),
    usageMonthPercentage: number(data.usageMonthPercentage),
    usagePeriodPercentage: number(data.usagePeriodPercentage),
    billingNextResetAt: nullableNumber(data.billingNextResetAt),
    usageFourHourNextResetAt: nullableNumber(data.usageFourHourNextResetAt),
    usageMonthNextResetAt: nullableNumber(data.usageMonthNextResetAt),
    usageWindowNextResetAt: nullableNumber(data.usageWindowNextResetAt),
  };
}

export function parseT3ChatSubscriptionData(data = {}) {
  return {
    isPaid: bool(data.isPaid),
    subTier: string(data.subTier),
  };
}

export async function fetchT3ChatQuota({ cookies, transport = new T3ChatTransport() }) {
  const lastCheckedAt = Date.now();

  try {
    const headers = {
      Cookie: cookies,
      "trpc-accept": "application/jsonl",
      "x-trpc-batch": "true",
      "x-trpc-source": "web-client",
      Referer: "https://t3.chat/",
    };

    const customerResponse = await transport.get(T3CHAT_CUSTOMER_DATA_URL, { headers });
    const subscriptionResponse = await transport.get(T3CHAT_SUBSCRIPTION_DATA_URL, { headers });
    const customer = extractT3ChatTrpcResult(customerResponse.text);
    const subscription = extractT3ChatTrpcResult(subscriptionResponse.text);

    if (!customer) {
      throw new Error("Could not parse customer data from T3Chat response");
    }

    return {
      status: "ok",
      lastCheckedAt,
      data: {
        ...parseT3ChatCustomerData(customer),
        ...parseT3ChatSubscriptionData(subscription || {}),
      },
    };
  } catch (error) {
    return {
      status: "error",
      lastCheckedAt,
      lastError: error.message || "Failed to refresh T3Chat quota",
    };
  }
}
