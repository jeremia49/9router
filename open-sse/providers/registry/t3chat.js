export default {
	id: "t3chat",
	priority: 70,
	alias: "t3chat",
	aliases: ["t3"],
	category: "webCookie",
	authType: "cookie",
	authHint: "Paste your full T3Chat cookie string and Convex session id.",
	hasProviderSpecificData: true,
	features: {
		usage: true,
	},
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
	},
	models: [
		// Qwen Models
		{ id: "qwen3-235b-thinking-2507", name: "Qwen3 235B Thinking" },
		{ id: "qwen3-235b-2507", name: "Qwen3 235B" },

		// Claude Models
		{ id: "claude-3.5", name: "Claude 3.5" },
		{ id: "claude-3.7", name: "Claude 3.7" },
		{ id: "claude-3.7-reasoning", name: "Claude 3.7 Reasoning" },
		{ id: "claude-4-opus", name: "Claude 4 Opus" },
		{ id: "claude-4-sonnet", name: "Claude 4 Sonnet" },
		{ id: "claude-4-sonnet-reasoning", name: "Claude 4 Sonnet Reasoning" },
		{ id: "claude-4.5-sonnet", name: "Claude 4.5 Sonnet" },
		{ id: "claude-4.5-sonnet-reasoning", name: "Claude 4.5 Sonnet Reasoning" },
		{ id: "claude-4.6-sonnet", name: "Claude 4.6 Sonnet" },
		{ id: "claude-4.6-sonnet-reasoning", name: "Claude 4.6 Sonnet Reasoning" },
		{ id: "claude-sonnet-5", name: "Claude Sonnet 5" },
		{ id: "claude-4.1-opus", name: "Claude 4.1 Opus" },
		{ id: "claude-4.5-haiku", name: "Claude 4.5 Haiku" },
		{ id: "claude-4.5-opus", name: "Claude 4.5 Opus" },
		{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" },
		{ id: "claude-4.7-opus", name: "Claude 4.7 Opus" },
		{ id: "claude-4.8-opus", name: "Claude 4.8 Opus" },

		// DeepSeek Models
		{ id: "deepseek-v3.1", name: "DeepSeek V3.1" },
		{ id: "deepseek-v3.1-thinking", name: "DeepSeek V3.1 Thinking" },
		{ id: "deepseek-v3.1-terminus", name: "DeepSeek V3.1 Terminus" },
		{
			id: "deepseek-v3.1-terminus-thinking",
			name: "DeepSeek V3.1 Terminus Thinking",
		},
		{ id: "deepseek-v-3.2", name: "DeepSeek V3.2" },
		{ id: "deepseek-v-3.2-thinking", name: "DeepSeek V3.2 Thinking" },
		{ id: "deepseek-r1-openrouter", name: "DeepSeek R1" },

		// Gemini Models
		{ id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
		{ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
		{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
		{ id: "gemini-3-pro", name: "Gemini 3 Pro" },
		{ id: "gemini-3-flash", name: "Gemini 3 Flash" },
		{ id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
		{ id: "gemini-3-flash-thinking", name: "Gemini 3 Flash Thinking" },
		{ id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" },
		{
			id: "gemini-3.1-flash-lite-thinking",
			name: "Gemini 3.1 Flash Lite Thinking",
		},
		{ id: "gemma-4-26b-a4b-it", name: "Gemma 4 26B" },

		// Llama Models
		{ id: "llama-4-scout", name: "Llama 4 Scout" },
		{ id: "llama-4-maverick", name: "Llama 4 Maverick" },

		// Minimax Models
		{ id: "minimax-m2", name: "Minimax M2" },
		{ id: "minimax-m2.1", name: "Minimax M2.1" },

		// Kimi Models
		{ id: "kimi-k2-0905", name: "Kimi K2" },
		{ id: "kimi-k2-thinking", name: "Kimi K2 Thinking" },

		// GPT OSS Models
		{ id: "gpt-oss-20b", name: "GPT OSS 20B" },
		{ id: "gpt-oss-120b", name: "GPT OSS 120B" },

		// GPT Models
		{ id: "gpt-4o-mini", name: "GPT-4o Mini" },
		{ id: "gpt-4o", name: "GPT-4o" },
		{ id: "gpt-4.1", name: "GPT-4.1" },
		{ id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
		{ id: "gpt-4.1-nano", name: "GPT-4.1 Nano" },
		{ id: "gpt-5", name: "GPT-5" },
		{ id: "gpt-5-reasoning", name: "GPT-5 Reasoning" },
		{ id: "gpt-5-mini", name: "GPT-5 Mini" },
		{ id: "gpt-5-nano", name: "GPT-5 Nano" },
		{ id: "gpt-5.1", name: "GPT-5.1" },
		{ id: "gpt-5.1-thinking", name: "GPT-5.1 Thinking" },
		{ id: "gpt-5.2", name: "GPT-5.2" },
		{ id: "gpt-o3-mini", name: "GPT-o3 Mini" },
		{ id: "gpt-o4-mini", name: "GPT-o4 Mini" },
		{ id: "o3-full", name: "o3 Full" },

		// Ling Models
		{ id: "ling-2.6-flash", name: "Ling 2.6 Flash" },

		// GLM Models
		{ id: "glm-4.5", name: "GLM 4.5" },
		{ id: "glm-4.5v", name: "GLM 4.5V" },
		{ id: "glm-4.5v-thinking", name: "GLM 4.5V Thinking" },
		{ id: "glm-4.5-air", name: "GLM 4.5 Air" },
		{ id: "glm-4.6", name: "GLM 4.6" },
		{ id: "glm-4.6-thinking", name: "GLM 4.6 Thinking" },
		{ id: "glm-4.6v", name: "GLM 4.6V" },

		// Grok Models
		{ id: "grok-v4", name: "Grok V4" },
		{ id: "grok-v3", name: "Grok V3" },
		{ id: "grok-v3-mini", name: "Grok V3 Mini" },
		{ id: "grok-4.20", name: "Grok 4.20" },
		{ id: "grok-v4-fast", name: "Grok V4 Fast" },
		{ id: "grok-4.3", name: "Grok 4.3" },
		{ id: "grok-4.1-fast", name: "Grok 4.1 Fast" },
	],
	serviceKinds: ["llm"],
};
