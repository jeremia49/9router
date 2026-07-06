#!/usr/bin/env node

/**
 * T3Chat Direct Connection Test
 * 
 * Tests if wreq-js can connect to T3Chat from this environment.
 * Helps identify if the issue is IP-based blocking or wreq-js compatibility.
 */

const CHAT_URL = "https://t3.chat/api/chat";

async function testT3ChatConnection() {
	console.log("=".repeat(60));
	console.log("T3CHAT DIRECT CONNECTION TEST");
	console.log("=".repeat(60));
	console.log();

	// Step 1: Load wreq-js
	console.log("Step 1: Loading wreq-js...");
	let wreqFetch;
	try {
		const mod = await import("wreq-js");
		wreqFetch = mod.fetch || mod.default?.fetch || mod;
		
		if (typeof wreqFetch !== "function") {
			console.error("✗ wreq-js loaded but no fetch function found");
			console.error("  Module exports:", Object.keys(mod));
			process.exit(1);
		}
		
		console.log("✓ wreq-js loaded successfully");
	} catch (error) {
		console.error("✗ Failed to load wreq-js:", error.message);
		console.error("\nPlease install: npm install wreq-js");
		process.exit(1);
	}
	console.log();

	// Step 2: Test basic GET request
	console.log("Step 2: Testing GET request to https://t3.chat...");
	try {
		const startTime = Date.now();
		const response = await wreqFetch("https://t3.chat", {
			method: "GET",
			browser: "chrome_136",
			os: "windows",
			timeout: 10000,
		});
		const elapsed = Date.now() - startTime;
		
		console.log("✓ GET request succeeded");
		console.log("  Status:", response.status);
		console.log("  Time:", elapsed, "ms");
		
		if (response.status === 403 || response.status === 429) {
			console.log("⚠ WARNING: Received", response.status);
			console.log("  This may indicate IP-based blocking or fingerprint rejection");
		}
	} catch (error) {
		console.error("✗ GET request failed:", error.message);
	}
	console.log();

	// Step 3: Test POST request (without real credentials)
	console.log("Step 3: Testing POST request to T3Chat API...");
	console.log("(Using dummy credentials - expect auth error if connection works)");
	
	try {
		const startTime = Date.now();
		const response = await wreqFetch(CHAT_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Cookie": "test=dummy",
				"Origin": "https://t3.chat",
				"Referer": "https://t3.chat/",
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
			},
			body: JSON.stringify({
				model: "gpt-4o-mini",
				messages: [{ role: "user", content: "test" }],
				stream: false,
			}),
			browser: "chrome_136",
			os: "windows",
			timeout: 10000,
		});
		
		const elapsed = Date.now() - startTime;
		const text = await response.text();
		
		console.log("✓ POST request completed");
		console.log("  Status:", response.status);
		console.log("  Time:", elapsed, "ms");
		console.log("  Response length:", text.length, "bytes");
		console.log("  Response preview:", text.substring(0, 200));
		
		// Interpret the response
		console.log();
		console.log("DIAGNOSIS:");
		if (response.status === 200) {
			console.log("✓ Connection works! (Unexpected with dummy credentials)");
		} else if (response.status === 401 || response.status === 403) {
			console.log("✓ Connection works! (Auth error is expected with dummy credentials)");
			console.log("  This means wreq-js and IP are OK.");
			console.log("  The issue may be with your actual credentials.");
		} else if (response.status === 429) {
			console.log("✗ Rate limit / Fingerprint rejection");
			console.log("  LIKELY CAUSES:");
			console.log("  1. Server IP is blocked by T3Chat");
			console.log("  2. Datacenter/VPS IP detected");
			console.log("  3. Too many requests from this IP");
			console.log();
			console.log("  SOLUTIONS:");
			console.log("  - Use a residential proxy");
			console.log("  - Try from a different IP");
			console.log("  - Wait and retry later");
		} else if (response.status >= 500) {
			console.log("? T3Chat server error (not your fault)");
		} else {
			console.log("? Unexpected response:", response.status);
		}
		
	} catch (error) {
		console.error("✗ POST request failed:", error.message);
		console.error("\nThis indicates:");
		console.error("  - Network connectivity problem");
		console.error("  - Firewall blocking");
		console.error("  - wreq-js compatibility issue");
	}
	
	console.log();
	console.log("=".repeat(60));
	console.log("TEST COMPLETE");
	console.log("=".repeat(60));
	console.log();
	console.log("If you see 429 errors, your server IP is likely blocked.");
	console.log("Compare this output with the same test run locally.");
}

// Run the test
testT3ChatConnection().catch(error => {
	console.error("\nFATAL ERROR:", error.message);
	process.exit(1);
});
