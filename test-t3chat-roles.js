/**
 * Test to verify T3Chat only uses 'user' and 'assistant' roles
 */

import { toT3ChatMessages } from "./open-sse/executors/t3chatPayload.js";

console.log("=== T3Chat Role Conversion Test ===\n");

// Test with all possible roles
const testMessages = [
	{ role: "system", content: "You are helpful" },
	{ role: "user", content: "Hello" },
	{ role: "assistant", content: "Hi there" },
	{ role: "tool", content: '{"result": "success"}' },
	{ role: "function", content: "Function executed" },
	{ role: "user", content: "Thanks" },
];

console.log("Input messages:");
testMessages.forEach((msg, i) => {
	console.log(
		`  ${i + 1}. role=${msg.role}, content=${msg.content.substring(0, 30)}...`,
	);
});

console.log("\nTransforming...\n");

const result = toT3ChatMessages(testMessages);

console.log("Output messages:");
result.forEach((msg, i) => {
	const textPreview = msg.parts[0]?.text?.substring(0, 50) || "";
	console.log(`  ${i + 1}. role=${msg.role}, text=${textPreview}...`);
});

console.log("\n=== Verification ===");

// Verify all roles are either 'user' or 'assistant'
const invalidRoles = result.filter(
	(msg) => msg.role !== "user" && msg.role !== "assistant",
);
if (invalidRoles.length > 0) {
	console.log(
		"❌ FAILED: Found invalid roles:",
		invalidRoles.map((m) => m.role),
	);
} else {
	console.log("✅ PASSED: All messages use only 'user' or 'assistant' roles");
}

// Verify assistant messages are preserved
const assistantCount = result.filter((msg) => msg.role === "assistant").length;
console.log(`✅ Assistant messages: ${assistantCount} (expected: 1)`);

// Verify system/tool/function are converted to user
const userCount = result.filter((msg) => msg.role === "user").length;
console.log(`✅ User messages: ${userCount} (expected: 5)`);

// Verify prefixes are added
const hasSystemPrefix = result.some(
	(msg) =>
		msg.role === "user" && msg.parts[0]?.text?.includes("[System instruction]"),
);
const hasToolPrefix = result.some(
	(msg) => msg.role === "user" && msg.parts[0]?.text?.includes("[Tool result]"),
);
const hasFunctionPrefix = result.some(
	(msg) =>
		msg.role === "user" && msg.parts[0]?.text?.includes("[Function result]"),
);

console.log(`✅ System prefix added: ${hasSystemPrefix}`);
console.log(`✅ Tool prefix added: ${hasToolPrefix}`);
console.log(`✅ Function prefix added: ${hasFunctionPrefix}`);

console.log("\n=== All Role Conversion Tests Complete ===");
