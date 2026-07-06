async function loadWreqFetch() {
	try {
		const mod = await import("wreq-js");
		const fetchFn = mod.fetch || mod.default?.fetch || mod;
		if (!fetchFn || typeof fetchFn !== "function") {
			throw new Error(
				"T3Chat provider requires wreq-js but it failed to load properly. " +
					"Install wreq-js: npm install wreq-js",
			);
		}
		return fetchFn;
	} catch (error) {
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
		this.fetchFn = await loadWreqFetch();
		// Verify this is wreq-js, not native fetch or other HTTP client
		if (this.fetchFn === globalThis.fetch || this.fetchFn === global.fetch) {
			throw new Error(
				"T3Chat provider detected non-wreq fetch. " +
					"T3Chat MUST use wreq-js exclusively. Check wreq-js installation.",
			);
		}
		return this.fetchFn;
	}

	async post(url, { headers, json, signal } = {}) {
		const fetchFn = await this.getFetch();

		try {
			const response = await fetchFn(url, {
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
			});

			// For error responses, read the body as text first
			if (response.status >= 400) {
				const text = await response.text();
				return {
					status: response.status,
					text,
				};
			}

			// For streaming responses, return the response directly
			if (response.body && typeof response.body.getReader === "function") {
				return {
					status: response.status,
					response: response,
					text: null,
				};
			}

			// For non-streaming, read the text
			const text = await response.text();
			return {
				status: response.status,
				text,
			};
		} catch (error) {
			throw error;
		}
	}

	async get(url, { headers, signal } = {}) {
		const fetchFn = await this.getFetch();

		const response = await fetchFn(url, {
			method: "GET",
			headers: headers || {},
			browser: "chrome_136",
			os: "windows",
			timeout: this.timeoutMs,
			signal,
		});

		const text = await response.text();
		return {
			status: response.status,
			text,
		};
	}
}
