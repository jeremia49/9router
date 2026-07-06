export function parseT3ChatBulkCredentials(text) {
	const valid = [];
	const invalid = [];
	const lines = String(text || "").split(/\r?\n/);

	for (let index = 0; index < lines.length; index++) {
		const line = index + 1;
		const raw = lines[index].trim();
		if (!raw) continue;

		const delimiterIndex = raw.indexOf("|");
		if (delimiterIndex === -1) {
			invalid.push({ line, reason: "Missing | delimiter" });
			continue;
		}

		const cookies = raw.slice(0, delimiterIndex).trim();
		const convexSessionId = raw.slice(delimiterIndex + 1).trim();

		if (!cookies) {
			invalid.push({ line, reason: "Cookies are required" });
			continue;
		}
		if (!convexSessionId) {
			invalid.push({ line, reason: "convexSessionId is required" });
			continue;
		}

		valid.push({ line, name: `T3Chat ${line}`, cookies, convexSessionId });
	}

	return { valid, invalid };
}
