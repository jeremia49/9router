async function loadWreqFetch() {
	try {
		console.log("[T3CHAT-WREQ-DEBUG] Attempting to load wreq-js module...");
		console.log("[T3CHAT-WREQ-DEBUG] Node version:", process.version);
		console.log("[T3CHAT-WREQ-DEBUG] Platform:", process.platform, process.arch);
		
		const mod = await import("wreq-js");
		console.log("[T3CHAT-WREQ-DEBUG] wreq-js module loaded");
		console.log("[T3CHAT-WREQ-DEBUG] Module keys:", Object.keys(mod));
		
		const fetchFn = mod.fetch || mod.default?.fetch || mod;
		if (!fetchFn || typeof fetchFn !== "function") {
			console.error("[T3CHAT-WREQ-DEBUG] wreq-js did not export a valid fetch function");
			console.error("[T3CHAT-WREQ-DEBUG] Exported:", typeof fetchFn);
			throw new Error(
				"T3Chat provider requires wreq-js but it failed to load properly. " +
					"Install wreq-js: npm install wreq-js",
			);
		}
		console.log("[T3CHAT-WREQ-DEBUG] wreq-js fetch function validated");
		return fetchFn;
	} catch (error) {
		console.error("[T3CHAT-WREQ-DEBUG] Failed to load wreq-js:", error.message);
		console.error("[T3CHAT-WREQ-DEBUG] Error code:", error.code);
		if (
			error.code === "ERR_MODULE_NOT_FOUND" ||
			error.message.includes("Cannot find")
		) {
			throw new Error(
				"T3Chat provider MUST use wreq-js HTTP client. " +
					"wreq-js is not installed. Install it with: npm install wreq-js",
			);
		}
		throw error;
	}
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

/**
 * T3ChatTransport - HTTP transport for T3Chat provider
 *
 * STRICT REQUIREMENT: This class MUST use wreq-js HTTP client exclusively.
 * T3Chat requires browser-like TLS fingerprinting and headers that only wreq-js provides.
 *
 * This transport will:
 * 1. Throw an error if wreq-js is not installed
 * 2. Throw an error if wreq-js fails to load properly
 * 3. Validate that the loaded fetch is wreq-js (not native fetch or other clients)
 *
 * DO NOT modify this to use:
 * - Native fetch (global.fetch)
 * - axios
 * - got
 * - node-fetch
 * - undici
 * - or any other HTTP client
 */
export class T3ChatTransport {
	constructor({ timeoutMs = 60000 } = {}) {
		this.timeoutMs = timeoutMs;
		this.fetchFn = null;
		this.provider = "t3chat";
	}

	async getFetch() {
		if (this.fetchFn) return this.fetchFn;
		
		console.log("[T3CHAT-TRANSPORT-DEBUG] Loading wreq-js...");
		this.fetchFn = await loadWreqFetch();
		console.log("[T3CHAT-TRANSPORT-DEBUG] wreq-js loaded successfully");
		
		// Verify this is wreq-js, not native fetch or other HTTP client
		if (this.fetchFn === globalThis.fetch || this.fetchFn === global.fetch) {
			console.error("[T3CHAT-TRANSPORT-DEBUG] ERROR: Detected native fetch instead of wreq-js!");
			throw new Error(
				"T3Chat provider detected non-wreq fetch. " +
					"T3Chat MUST use wreq-js exclusively. Check wreq-js installation.",
			);
		}
		
		console.log("[T3CHAT-TRANSPORT-DEBUG] Validated: Using wreq-js (not native fetch)");
		return this.fetchFn;
	}

	async post(url, { headers, json, signal, proxyOptions = null } = {}) {
		const fetchFn = await this.getFetch();
		
		console.log("[T3CHAT-TRANSPORT-DEBUG] Making POST request to:", url);
		console.log("[T3CHAT-TRANSPORT-DEBUG] Browser fingerprint: chrome_136 / windows");
		console.log("[T3CHAT-TRANSPORT-DEBUG] Timeout:", this.timeoutMs, "ms");
		
		// Determine proxy from multiple sources (priority order):
		// 1. proxyOptions from credentials (highest priority)
		// 2. T3CHAT_PROXY environment variable
		// 3. HTTPS_PROXY environment variable
		let proxyUrl = null;
		
		if (proxyOptions?.connectionProxyEnabled && proxyOptions?.connectionProxyUrl) {
			proxyUrl = proxyOptions.connectionProxyUrl;
			console.log("[T3CHAT-TRANSPORT-DEBUG] Using proxy from credentials:", proxyUrl.replace(/:\/\/.*@/, "://***@"));
		} else {
			proxyUrl = process.env.T3CHAT_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy;
			if (proxyUrl) {
				console.log("[T3CHAT-TRANSPORT-DEBUG] Using proxy from environment:", proxyUrl.replace(/:\/\/.*@/, "://***@"));
			}
		}

		try {
			const options = {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...headers,
				},
				body: JSON.stringify(json),
				browser: "chrome_136",
				os: "windows",
				timeout: this.timeoutMs,
				signal,
			};
			
			// Add proxy if configured (helps bypass Vercel Security Checkpoint)
			if (proxyUrl) {
				options.proxy = proxyUrl;
			}
			
			const response = await fetchFn(url, options);
			
			console.log("[T3CHAT-TRANSPORT-DEBUG] Response status:", response.status);
			console.log("[T3CHAT-TRANSPORT-DEBUG] Response headers:", response.headers ? Object.fromEntries([...response.headers.entries()].slice(0, 5)) : "none");

			// For error responses, read the body as text first
			if (response.status >= 400) {
				const text = await response.text();
				console.error("[T3CHAT-TRANSPORT-DEBUG] Error response body:", text.substring(0, 300));
				return {
					status: response.status,
					text,
				};
			}

			// For streaming responses, return the response directly
			if (response.body && typeof response.body.getReader === "function") {
				console.log("[T3CHAT-TRANSPORT-DEBUG] Streaming response detected");
				return {
					status: response.status,
					response: response,
					text: null,
				};
			}

			// For non-streaming, read the text
			const text = await response.text();
			console.log("[T3CHAT-TRANSPORT-DEBUG] Non-streaming response length:", text.length);
			return {
				status: response.status,
				text,
			};
		} catch (error) {
			console.error("[T3CHAT-TRANSPORT-DEBUG] Request failed:", error.message);
			console.error("[T3CHAT-TRANSPORT-DEBUG] Error stack:", error.stack);
			throw error;
		}
	}

	async get(url, { headers, signal, proxyOptions = null } = {}) {
		const fetchFn = await this.getFetch();
		
		// Determine proxy from multiple sources
		let proxyUrl = null;
		
		if (proxyOptions?.connectionProxyEnabled && proxyOptions?.connectionProxyUrl) {
			proxyUrl = proxyOptions.connectionProxyUrl;
			console.log("[T3CHAT-TRANSPORT-DEBUG] GET using proxy from credentials:", proxyUrl.replace(/:\/\/.*@/, "://***@"));
		} else {
			proxyUrl = process.env.T3CHAT_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy;
			if (proxyUrl) {
				console.log("[T3CHAT-TRANSPORT-DEBUG] GET using proxy from environment:", proxyUrl.replace(/:\/\/.*@/, "://***@"));
			}
		}
		
		const options = {
			method: "GET",
			headers: headers || {},
			browser: "chrome_136",
			os: "windows",
			timeout: this.timeoutMs,
			signal,
		};
		
		// Add proxy if configured (helps bypass Vercel Security Checkpoint)
		if (proxyUrl) {
			options.proxy = proxyUrl;
		}

		const response = await fetchFn(url, options);

		const text = await response.text();
		return {
			status: response.status,
			text,
		};
	}
}
