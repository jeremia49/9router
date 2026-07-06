async function loadWreqFetch() {
	const mod = await import("wreq-js");
	return mod.fetch || mod.default?.fetch || mod;
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
	constructor({ timeoutMs = 60000 } = {}) {
		this.timeoutMs = timeoutMs;
		this.fetchFn = null;
	}

	async getFetch() {
		if (this.fetchFn) return this.fetchFn;
		this.fetchFn = await loadWreqFetch();
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
