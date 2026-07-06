import { fetchT3ChatQuota } from "@/lib/t3chat/quota.js";

/**
 * Get T3Chat usage/quota data
 * @param {Object} providerSpecificData - Connection provider-specific data containing cookies
 * @returns {Object} Usage data with quotas
 */
export async function getT3ChatUsage(providerSpecificData) {
	const cookies = providerSpecificData?.cookies;
	if (!cookies) {
		return {
			message:
				"T3Chat cookies are missing. Please update your connection credentials.",
		};
	}

	// Fetch quota from T3Chat
	const quotaResult = await fetchT3ChatQuota({ cookies });

	if (quotaResult.status === "error") {
		return {
			message: quotaResult.lastError || "Failed to fetch T3Chat quota",
		};
	}

	const data = quotaResult.data || {};

	// Build quota entries based on available data
	const quotas = {};

	// Balance quota (if available and reliable)
	if (data.isBalanceReliable && typeof data.balance === "number") {
		quotas.balance = {
			used: data.lifetimeBalance - data.balance,
			total: data.lifetimeBalance,
			remaining: data.balance,
			resetAt: null,
		};
	}

	// Usage windows
	if (typeof data.usageFourHourPercentage === "number") {
		quotas.fourHour = {
			used: data.usageFourHourPercentage,
			total: 100,
			remaining: 100 - data.usageFourHourPercentage,
			resetAt: data.usageFourHourNextResetAt
				? new Date(data.usageFourHourNextResetAt).toISOString()
				: null,
		};
	}

	if (typeof data.usageMonthPercentage === "number") {
		quotas.monthly = {
			used: data.usageMonthPercentage,
			total: 100,
			remaining: 100 - data.usageMonthPercentage,
			resetAt: data.usageMonthNextResetAt
				? new Date(data.usageMonthNextResetAt).toISOString()
				: null,
		};
	}

	if (typeof data.usagePeriodPercentage === "number") {
		quotas.period = {
			used: data.usagePeriodPercentage,
			total: 100,
			remaining: 100 - data.usagePeriodPercentage,
			resetAt: data.usageWindowNextResetAt
				? new Date(data.usageWindowNextResetAt).toISOString()
				: null,
		};
	}

	// Billing reset
	if (data.billingNextResetAt) {
		quotas.billing = {
			used: 0,
			total: 100,
			remaining: 100,
			resetAt: new Date(data.billingNextResetAt).toISOString(),
		};
	}

	return {
		quotas,
		plan: data.subTier || null,
		isPaid: data.isPaid || false,
		usageBand: data.usageBand || null,
		billingProvider: data.billingProvider || null,
	};
}
