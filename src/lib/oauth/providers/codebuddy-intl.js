import { CODEBUDDY_INTL_CONFIG } from "../constants/oauth.js";

// CodeBuddy International — the official CLI's browser hand-off flow against
// codebuddy.ai (NOT the older IDE plugin, which used platform=ide):
//
//   1. POST /v2/plugin/auth/state?platform=CLI     → { state, authUrl }
//   2. Open authUrl in a browser (version=<pluginVersion> hint)
//   3. GET  /v2/plugin/auth/token?state=<state>    → code 11217 while pending,
//                                                    data.accessToken on success
//   4. GET  /v2/plugin/account   (Bearer)          → uid / account type
//
// The account call is what makes the gateway's X-User-Id real: the CLI sends
// the logged-in uid (or `anonymous_<last8>` for raw API keys) instead of the
// "Bearer undefined" the shared auth path would otherwise produce.
const CODEBUDDY_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  "X-Domain": "www.codebuddy.ai",
  "X-Product": "SaaS",
};

const codebuddyIntl = {
  config: CODEBUDDY_INTL_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (config) => {
    const response = await fetch(`${config.stateUrl}?platform=${config.platform}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": config.userAgent,
        ...CODEBUDDY_HEADERS,
        "X-No-Authorization": "true",
        "X-No-User-Id": "true",
        "X-No-Enterprise-Id": "true",
        "X-No-Department-Info": "true",
      },
      body: "{}",
    });
    if (!response.ok) throw new Error(`CodeBuddy Intl state request failed: ${await response.text()}`);
    const data = await response.json();
    if (data.code !== 0 || !data.data?.state || !data.data?.authUrl) {
      throw new Error(`CodeBuddy Intl state error: ${data.msg || "missing state/authUrl"}`);
    }
    return {
      device_code: data.data.state,
      verification_uri: data.data.authUrl,
      user_code: "",
      interval: config.pollInterval / 1000,
      _isCodeBuddy: true,
    };
  },
  pollToken: async (config, deviceCode) => {
    const response = await fetch(`${config.tokenUrl}?state=${encodeURIComponent(deviceCode)}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": config.userAgent,
        ...CODEBUDDY_HEADERS,
        "X-No-Authorization": "true",
        "X-No-User-Id": "true",
        "X-No-Enterprise-Id": "true",
        "X-No-Department-Info": "true",
      },
    });
    if (!response.ok) return { ok: false, data: { error: "request_failed" } };
    const data = await response.json();
    if (data.code === 0 && data.data?.accessToken) {
      return {
        ok: true,
        data: {
          access_token: data.data.accessToken,
          refresh_token: data.data.refreshToken || "",
          token_type: data.data.tokenType || "Bearer",
          expires_in: data.data.expiresIn,
        },
      };
    }
    // 11217 = "login ing..." (RetryFetchToken) — keep polling.
    if (data.code === 11217) return { ok: true, data: { error: "authorization_pending" } };
    return { ok: false, data: { error: data.msg || "unknown_error" } };
  },
  // Runs after the token grant succeeds: resolve the account so the connection
  // records a real uid/email and the gateway sees the same X-User-Id as the CLI.
  postExchange: async (tokens) => {
    const accessToken = tokens?.access_token;
    if (!accessToken) return null;
    const config = CODEBUDDY_INTL_CONFIG;
    try {
      const response = await fetch(config.accountUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": config.userAgent,
          ...CODEBUDDY_HEADERS,
        },
      });
      if (!response.ok) return null;
      const json = await response.json();
      const account = json?.data;
      if (!account || typeof account !== "object") return null;
      const uid = typeof account.uid === "string" ? account.uid : null;
      if (!uid) return null;
      return {
        uid,
        email: account.email || account.mail || null,
        nickname: account.nickname || account.nickName || null,
        accountType: account.type || null,
        enterpriseId: account.enterpriseId || null,
      };
    } catch {
      // Non-fatal: the connection still works, only X-User-Id falls back.
      return null;
    }
  },
  mapTokens: (tokens, extra) => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in || 86400,
    email: extra?.email || null,
    displayName: extra?.nickname || extra?.email || null,
    providerSpecificData: {
      ...(extra?.uid ? { uid: extra.uid } : {}),
      ...(extra?.accountType ? { accountType: extra.accountType } : {}),
      ...(extra?.enterpriseId ? { enterpriseId: extra.enterpriseId } : {}),
    },
  }),
};

export default codebuddyIntl;
