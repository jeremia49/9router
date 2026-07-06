/**
 * T3Chat Proxy Configuration
 * 
 * Handles proxy configuration for bypassing Vercel Security Checkpoint
 * and other IP-based blocking.
 */

/**
 * Get proxy configuration from multiple sources
 * Priority order:
 * 1. T3CHAT_PROXY environment variable (highest priority)
 * 2. HTTPS_PROXY environment variable
 * 3. HTTP_PROXY environment variable
 * 4. ALL_PROXY environment variable
 * 
 * @returns {string|null} Proxy URL or null if not configured
 */
export function getProxyConfig() {
	const proxyUrl = 
		process.env.T3CHAT_PROXY ||
		process.env.HTTPS_PROXY ||
		process.env.https_proxy ||
		process.env.HTTP_PROXY ||
		process.env.http_proxy ||
		process.env.ALL_PROXY ||
		process.env.all_proxy;
	
	if (!proxyUrl) return null;
	
	// Validate proxy URL format
	try {
		new URL(proxyUrl);
		return proxyUrl;
	} catch (error) {
		console.error("[T3CHAT-PROXY] Invalid proxy URL:", proxyUrl);
		return null;
	}
}

/**
 * Mask proxy credentials in URLs for logging
 * 
 * @param {string} proxyUrl - Full proxy URL with credentials
 * @returns {string} Masked URL safe for logging
 */
export function maskProxyCredentials(proxyUrl) {
	if (!proxyUrl) return "(none)";
	
	try {
		const url = new URL(proxyUrl);
		if (url.username || url.password) {
			return `${url.protocol}//${url.username ? '***' : ''}${url.password ? ':***' : ''}@${url.host}`;
		}
		return proxyUrl;
	} catch {
		return proxyUrl.replace(/:\/\/[^@]+@/, "://***@");
	}
}

/**
 * Check if proxy is configured
 * 
 * @returns {boolean} True if proxy is configured
 */
export function isProxyConfigured() {
	return getProxyConfig() !== null;
}

/**
 * Get proxy type from URL
 * 
 * @param {string} proxyUrl - Proxy URL
 * @returns {string} Proxy type (http, https, socks5, etc.)
 */
export function getProxyType(proxyUrl) {
	if (!proxyUrl) return "none";
	
	try {
		const url = new URL(proxyUrl);
		return url.protocol.replace(":", "");
	} catch {
		return "unknown";
	}
}

/**
 * Validate proxy configuration
 * 
 * @returns {Object} Validation result with status and message
 */
export function validateProxyConfig() {
	const proxyUrl = getProxyConfig();
	
	if (!proxyUrl) {
		return {
			valid: true,
			configured: false,
			message: "No proxy configured (using direct connection)",
		};
	}
	
	try {
		const url = new URL(proxyUrl);
		const type = url.protocol.replace(":", "");
		
		// Check if proxy type is supported by wreq-js
		const supportedTypes = ["http", "https", "socks5", "socks5h"];
		if (!supportedTypes.includes(type)) {
			return {
				valid: false,
				configured: true,
				message: `Unsupported proxy type: ${type}. Supported: ${supportedTypes.join(", ")}`,
				proxyUrl: maskProxyCredentials(proxyUrl),
			};
		}
		
		return {
			valid: true,
			configured: true,
			type,
			message: `Valid proxy configured: ${type}`,
			proxyUrl: maskProxyCredentials(proxyUrl),
		};
	} catch (error) {
		return {
			valid: false,
			configured: true,
			message: `Invalid proxy URL: ${error.message}`,
			proxyUrl: maskProxyCredentials(proxyUrl),
		};
	}
}

/**
 * Log proxy configuration status
 */
export function logProxyConfig() {
	const validation = validateProxyConfig();
	
	console.log("[T3CHAT-PROXY] Configuration:");
	console.log("[T3CHAT-PROXY]   Configured:", validation.configured ? "Yes" : "No");
	
	if (validation.configured) {
		console.log("[T3CHAT-PROXY]   Valid:", validation.valid ? "Yes" : "No");
		console.log("[T3CHAT-PROXY]   Type:", validation.type || "unknown");
		console.log("[T3CHAT-PROXY]   URL:", validation.proxyUrl);
		console.log("[T3CHAT-PROXY]   Message:", validation.message);
		
		if (!validation.valid) {
			console.error("[T3CHAT-PROXY] ⚠ WARNING: Proxy configuration is invalid!");
			console.error("[T3CHAT-PROXY] T3Chat requests will likely fail with Vercel Security Checkpoint.");
		}
	} else {
		console.log("[T3CHAT-PROXY]   Message:", validation.message);
		console.log("[T3CHAT-PROXY] ⚠ WARNING: No proxy configured!");
		console.log("[T3CHAT-PROXY]   If running on datacenter/VPS, T3Chat may be blocked by Vercel.");
		console.log("[T3CHAT-PROXY]   Set T3CHAT_PROXY environment variable to use a residential proxy.");
	}
}

export default {
	getProxyConfig,
	maskProxyCredentials,
	isProxyConfigured,
	getProxyType,
	validateProxyConfig,
	logProxyConfig,
};
