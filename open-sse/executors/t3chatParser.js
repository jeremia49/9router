function pushText(value, parts) {
  if (typeof value?.delta === "string") {
    parts.push(value.delta);
    return;
  }
  if (value?.delta && typeof value.delta === "object" && typeof value.delta.text === "string") {
    parts.push(value.delta.text);
    return;
  }
  if (typeof value?.text === "string") {
    parts.push(value.text);
    return;
  }
  if (Array.isArray(value?.content)) {
    for (const item of value.content) {
      if (typeof item?.text === "string") {
        parts.push(item.text);
      }
    }
  }
}

export function parseT3ChatTextResponse(body) {
  const parts = [];
  for (const line of String(body || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice("data:".length).trim();
    if (data === "[DONE]") break;

    let value;
    try {
      value = JSON.parse(data);
    } catch {
      continue;
    }

    if (value?.type === "text-delta" || value?.type === "text") {
      pushText(value, parts);
    }
  }

  const text = parts.join("").trim();
  if (!text) {
    throw new Error("T3Chat returned no parseable text content");
  }
  return text;
}

export const __test__ = { pushText };
