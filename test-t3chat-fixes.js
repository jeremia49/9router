/**
 * Test script to verify T3Chat fixes
 *
 * Usage:
 *   node test-t3chat-fixes.js
 *
 * This will test the message transformation and payload validation
 * without making actual API calls.
 */

import {
	toT3ChatMessages,
	buildT3ChatPayload,
} from "./open-sse/executors/t3chatPayload.js";
import { randomUUID } from "node:crypto";

console.log("=== T3Chat Fixes Verification ===\n");

// Test 1: Valid messages
console.log("Test 1: Valid messages transformation");
const validMessages = [
	{ role: "system", content: "You are a helpful assistant." },
	{ role: "user", content: "Hello!" },
	{ role: "assistant", content: "Hi there!" },
	{ role: "user", content: "How are you?" },
];

try {
	const transformed = toT3ChatMessages(validMessages);
	console.log(
		"✅ Transformed",
		validMessages.length,
		"messages to",
		transformed.length,
		"T3Chat messages",
	);
	console.log("   First message role:", transformed[0].role);
	console.log(
		"   Last message role:",
		transformed[transformed.length - 1].role,
	);
} catch (error) {
	console.error("❌ Failed:", error.message);
}

console.log("\nTest 2: Empty messages array");
try {
	const transformed = toT3ChatMessages([]);
	console.log("⚠️  Empty array returned", transformed.length, "messages");
} catch (error) {
	console.error("❌ Failed:", error.message);
}

console.log("\nTest 3: Messages with null content");
const messagesWithNull = [
	{ role: "user", content: null },
	{ role: "user", content: "Valid message" },
];

try {
	const transformed = toT3ChatMessages(messagesWithNull);
	console.log(
		"✅ Handled null content, got",
		transformed.length,
		"valid messages",
	);
} catch (error) {
	console.error("❌ Failed:", error.message);
}

console.log("\nTest 4: Tool/function messages");
const messagesWithTools = [
	{ role: "user", content: "What's the weather?" },
	{ role: "tool", content: '{"temperature": 72, "condition": "sunny"}' },
	{ role: "assistant", content: "It's 72°F and sunny." },
];

try {
	const transformed = toT3ChatMessages(messagesWithTools);
	console.log(
		"✅ Transformed tool messages, got",
		transformed.length,
		"messages",
	);
	console.log("   Tool message converted to role:", transformed[1].role);
} catch (error) {
	console.error("❌ Failed:", error.message);
}

console.log("\nTest 5: Full payload validation");
const mockCredentials = {
	providerSpecificData: {
		cookies: "test-cookie-value",
		convexSessionId: "test-session-id",
	},
};

const mockBody = {
	messages: [{ role: "user", content: "Test message" }],
};

try {
	const payload = buildT3ChatPayload({
		model: "gemini-2.5-flash",
		body: mockBody,
		credentials: mockCredentials,
		threadId: randomUUID(),
		responseMessageId: randomUUID(),
	});

	console.log("✅ Payload built successfully");
	console.log("   Messages count:", payload.messages.length);
	console.log("   Model:", payload.model);
	console.log("   Has threadMetadata:", !!payload.threadMetadata);
	console.log("   Has convexSessionId:", !!payload.convexSessionId);

	// Validate message structure
	const firstMsg = payload.messages[0];
	if (firstMsg.id && firstMsg.role && Array.isArray(firstMsg.parts)) {
		console.log("✅ Message structure valid (id, role, parts)");
	} else {
		console.log("❌ Message structure invalid");
	}
} catch (error) {
	console.error("❌ Failed:", error.message);
}

console.log("\nTest 6: Empty messages should fail validation");
try {
	const payload = buildT3ChatPayload({
		model: "gemini-2.5-flash",
		body: { messages: [] },
		credentials: mockCredentials,
		threadId: randomUUID(),
		responseMessageId: randomUUID(),
	});
	console.log("❌ Should have thrown error for empty messages");
} catch (error) {
	console.log("✅ Correctly rejected empty messages:", error.message);
}

console.log("\nTest 7: Invalid message objects");
const invalidMessages = [
	{ role: "user", content: "Valid" },
	null,
	{ role: "user" }, // missing content
	{ content: "No role" },
];

try {
	const transformed = toT3ChatMessages(invalidMessages);
	console.log(
		"✅ Handled invalid messages, got",
		transformed.length,
		"valid messages",
	);
} catch (error) {
	console.error("❌ Failed:", error.message);
}

console.log("\n=== All Tests Complete ===");
console.log("\nIf all tests passed, the T3Chat fixes are working correctly.");
console.log(
	"Next step: Test with actual API calls to verify network behavior.",
);
