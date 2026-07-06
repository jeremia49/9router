export default {
	id: "t3chat",
	priority: 70,
	alias: "t3chat",
	aliases: ["t3"],
	category: "webCookie",
	authType: "cookie",
	authHint: "Paste your full T3Chat cookie string and Convex session id.",
	hasProviderSpecificData: true,
	display: {
		name: "T3Chat",
		icon: "forum",
		color: "#7C3AED",
		textIcon: "T3",
		website: "https://t3.chat",
		notice: {
			message:
				"Requires a T3Chat browser session cookie and convex_session_id per account.",
		},
	},
	transport: {
		baseUrl: "https://t3.chat/api/chat",
		format: "openai",
		authType: "cookie",
		forceStream: true,
	},
	models: [
		{ id: "gpt-4o-mini", name: "GPT-4o Mini" },
		{ id: "gpt-4o", name: "GPT-4o" },
		{ id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet" },
		{ id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
	],
	serviceKinds: ["llm"],
};
