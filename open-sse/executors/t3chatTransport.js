async function loadWreq() {
  const mod = await import("wreq-js");
  return mod.default || mod;
}

function pickClientFactory(wreq) {
  return wreq.Client || wreq.client || wreq.createClient || wreq.default || wreq;
}

export async function normalizeWreqResponse(response) {
  const status = response.status ?? response.statusCode ?? 0;
  let text = response.text;

  if (typeof text === "function") {
    text = await response.text();
  }
  if (text === undefined && response.body !== undefined) {
    text = String(response.body);
  }

  return { status, text: String(text || "") };
}

export class T3ChatTransport {
  constructor({ client = null, timeoutMs = 60000 } = {}) {
    this.client = client;
    this.timeoutMs = timeoutMs;
  }

  async getClient() {
    if (this.client) return this.client;

    const wreq = await loadWreq();
    const factory = pickClientFactory(wreq);
    if (typeof factory === "function") {
      this.client = new factory({ emulation: "chrome136", timeout: this.timeoutMs });
    } else {
      this.client = factory;
    }
    return this.client;
  }

  async post(url, { headers, json, signal } = {}) {
    const client = await this.getClient();
    if (typeof client.post !== "function") {
      throw new Error("wreq-js client does not expose post()");
    }

    const response = await client.post(url, {
      headers,
      json,
      body: json,
      timeout: this.timeoutMs,
      signal,
      emulation: "chrome136",
      impersonate: "chrome136",
    });
    return normalizeWreqResponse(response);
  }

  async get(url, { headers, signal } = {}) {
    const client = await this.getClient();
    if (typeof client.get !== "function") {
      throw new Error("wreq-js client does not expose get()");
    }

    const response = await client.get(url, {
      headers,
      timeout: this.timeoutMs,
      signal,
      emulation: "chrome136",
      impersonate: "chrome136",
    });
    return normalizeWreqResponse(response);
  }
}
