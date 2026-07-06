export function getT3ChatCredentials(credentials = {}) {
	const data = credentials.providerSpecificData || {};
	const cookies = String(data.cookies || credentials.apiKey || "").trim();
	const convexSessionId = String(
		data.convexSessionId || data.convex_session_id || "",
	).trim();

	if (!cookies || !convexSessionId) {
		throw new Error("T3Chat cookies and convexSessionId are required");
	}

	return { cookies, convexSessionId };
}

export function toT3ChatMessages(messages = []) {
	if (!Array.isArray(messages)) return [];
	return messages.map((message) => ({
		role: message.role,
		content: message.content,
	}));
}

export function buildT3ChatPayload({
	model,
	body,
	credentials,
	threadId,
	responseMessageId,
}) {
	const { convexSessionId } = getT3ChatCredentials(credentials);
	const reasoningEffort = body?.reasoning_effort || "medium";

	return {
		messages: toT3ChatMessages(body?.messages),
		threadMetadata: { id: threadId, title: "" },
		clientAuth: { isSignedIn: true },
		responseMessageId,
		model,
		convexSessionId,
		modelParams: {
			reasoningEffort,
			includeSearch: false,
			searchLimit: 1,
		},
		preferences: {
			name: "",
			occupation: "",
			selectedTraits: [],
			additionalInfo: "",
		},
		userConfiguration: {
			codeFont: "berkeley",
			currentModelParameters: {
				includeSearch: false,
				reasoningEffort,
			},
			currentlySelectedModel: model,
			favoriteModels: [],
			hasMigrated: true,
			mainFont: "proxima",
			streamerMode: false,
			theme: "dark",
		},
		userInfo: { timezone: "America/New_York", locale: "en-US" },
		isEphemeral: false,
	};
}

export function buildT3ChatHeaders({ cookies, threadId }) {
	return {
		"Content-Type": "application/json",
		Referer: `https://t3.chat/chat/${threadId}`,
		Cookie: cookies,
		Origin: "https://t3.chat",
		Accept: "*/*",
	};
}
