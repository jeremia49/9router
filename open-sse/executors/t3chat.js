import { randomUUID } from "node:crypto";

import { PROVIDERS } from "../config/providers.js";
import { BaseExecutor } from "./base.js";
import { parseT3ChatTextResponse } from "./t3chatParser.js";
import { buildT3ChatHeaders, buildT3ChatPayload, getT3ChatCredentials } from "./t3chatPayload.js";
import { T3ChatTransport } from "./t3chatTransport.js";

const CHAT_URL = "https://t3.chat/api/chat";
let transportFactory = null;

function createTextResponse(text, status = 200, model = "t3chat") {
  return new Response(JSON.stringify({
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: text },
      finish_reason: "stop",
    }],
  }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export class T3ChatExecutor extends BaseExecutor {
  constructor() {
    super("t3chat", PROVIDERS.t3chat);
  }

  buildUrl() {
    return CHAT_URL;
  }

  async execute({ model, body, credentials, signal, log }) {
    const threadId = randomUUID();
    const responseMessageId = randomUUID();
    const { cookies } = getT3ChatCredentials(credentials);
    const headers = buildT3ChatHeaders({ cookies, threadId });
    const transformedBody = buildT3ChatPayload({ model, body, credentials, threadId, responseMessageId });
    const transport = transportFactory ? transportFactory() : new T3ChatTransport();

    log?.debug?.("FETCH", `T3CHAT → ${CHAT_URL}`);
    const upstream = await transport.post(CHAT_URL, { headers, json: transformedBody, signal });

    if (upstream.status === 401 || upstream.status === 403) {
      throw new Error("T3Chat rejected the provided session. Refresh cookies and convexSessionId.");
    }
    if (upstream.status === 429) {
      throw new Error("T3Chat returned HTTP 429. This can mean rate limiting or browser-fingerprint rejection; retry later and refresh credentials if it persists.");
    }
    if (upstream.status >= 400) {
      throw new Error(`T3Chat returned HTTP ${upstream.status}.`);
    }

    const text = parseT3ChatTextResponse(upstream.text);
    return {
      response: createTextResponse(text, 200, model),
      url: CHAT_URL,
      headers,
      transformedBody,
    };
  }
}

export const __test__ = {
  setT3ChatTransportFactory(factory) {
    transportFactory = factory;
  },
  createT3ChatTextResponse: createTextResponse,
};

export default T3ChatExecutor;
