#!/usr/bin/env node

/**
 * T3Chat Debug Script
 * 
 * This script helps diagnose why T3Chat works locally but fails on server.
 * Run this on both environments and compare the output.
 */

console.log("=".repeat(60));
console.log("T3CHAT ENVIRONMENT DEBUG");
console.log("=".repeat(60));
console.log();

// 1. Node.js Version
console.log("1. NODE.JS ENVIRONMENT");
console.log("   Version:", process.version);
console.log("   Platform:", process.platform);
console.log("   Architecture:", process.arch);
console.log("   Node Path:", process.execPath);
console.log();

// 2. wreq-js availability
console.log("2. WREQ-JS MODULE CHECK");
try {
	const wreqPath = require.resolve("wreq-js");
	console.log("   ✓ wreq-js found at:", wreqPath);
	
	const wreq = require("wreq-js");
	console.log("   ✓ wreq-js loaded successfully");
	console.log("   Module exports:", Object.keys(wreq));
	
	if (typeof wreq.fetch === "function") {
		console.log("   ✓ wreq.fetch is a function");
	} else if (typeof wreq.default?.fetch === "function") {
		console.log("   ✓ wreq.default.fetch is a function");
	} else {
		console.log("   ✗ wreq-js does not export a fetch function!");
	}
} catch (error) {
	console.log("   ✗ wreq-js NOT found:", error.message);
	console.log("   Install with: npm install wreq-js");
}
console.log();

// 3. Network environment
console.log("3. NETWORK ENVIRONMENT");
console.log("   HTTP_PROXY:", process.env.HTTP_PROXY || "(not set)");
console.log("   HTTPS_PROXY:", process.env.HTTPS_PROXY || "(not set)");
console.log("   NO_PROXY:", process.env.NO_PROXY || "(not set)");
console.log();

// 4. Test wreq-js actual request
console.log("4. WREQ-JS TEST REQUEST");
(async () => {
	try {
		const mod = await import("wreq-js");
		const wreqFetch = mod.fetch || mod.default?.fetch || mod;
		
		console.log("   Attempting test request to https://t3.chat...");
		const startTime = Date.now();
		
		const response = await wreqFetch("https://t3.chat", {
			method: "GET",
			browser: "chrome_136",
			os: "windows",
			timeout: 10000,
		});
		
		const elapsed = Date.now() - startTime;
		console.log("   ✓ Request succeeded");
		console.log("   Status:", response.status);
		console.log("   Time:", elapsed, "ms");
		
		if (response.status === 429) {
			console.log("   ⚠ WARNING: Received 429 - IP or fingerprint may be blocked!");
		}
	} catch (error) {
		console.log("   ✗ Request failed:", error.message);
		console.log("   This could indicate:");
		console.log("     - Network connectivity issues");
		console.log("     - Firewall blocking");
		console.log("     - wreq-js binary compatibility issues");
	}
	
	console.log();
	console.log("=".repeat(60));
	console.log("DEBUG COMPLETE");
	console.log("=".repeat(60));
})();
