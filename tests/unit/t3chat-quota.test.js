import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	extractT3ChatTrpcResult,
	fetchT3ChatQuota,
	parseT3ChatCustomerData,
	parseT3ChatSubscriptionData,
} from "../../src/lib/t3chat/quota.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;

describe("T3Chat quota parsing", () => {
	it("extracts tRPC result data from JSON response and JSONL", () => {
		const body = JSON.stringify([
			{ result: { data: { json: { balance: 10, subTier: "pro" } } } },
		]);
		expect(extractT3ChatTrpcResult(body)).toEqual({
			balance: 10,
			subTier: "pro",
		});
		expect(
			extractT3ChatTrpcResult('{"result":{"data":{"json":{"balance":4}}}}\n'),
		).toEqual({ balance: 4 });
	});

	it("parses customer and subscription data with safe defaults", () => {
		expect(
			parseT3ChatCustomerData({
				subTier: "pro",
				balance: 12.5,
				lifetimeBalance: 99,
				isBalanceReliable: true,
				usageBand: "normal",
				billingProvider: "stripe",
				usageFourHourPercentage: 20,
				usageMonthPercentage: 30,
				usagePeriodPercentage: 40,
				billingNextResetAt: 1,
			}),
		).toMatchObject({
			subTier: "pro",
			balance: 12.5,
			lifetimeBalance: 99,
			isBalanceReliable: true,
			usageFourHourPercentage: 20,
			billingNextResetAt: 1,
		});

		expect(
			parseT3ChatSubscriptionData({ isPaid: true, subTier: "pro" }),
		).toEqual({ isPaid: true, subTier: "pro" });
	});

	it("fetches quota and returns non-blocking error state on failure", async () => {
		const okTransport = {
			get: vi
				.fn()
				.mockResolvedValueOnce({
					status: 200,
					text: JSON.stringify([
						{ result: { data: { json: { balance: 7, subTier: "pro" } } } },
					]),
				})
				.mockResolvedValueOnce({
					status: 200,
					text: JSON.stringify([
						{ result: { data: { json: { isPaid: true, subTier: "pro" } } } },
					]),
				}),
		};
		const ok = await fetchT3ChatQuota({
			cookies: "c=1",
			transport: okTransport,
		});
		expect(ok.status).toBe("ok");
		expect(ok.data).toMatchObject({ balance: 7, subTier: "pro", isPaid: true });

		const fail = await fetchT3ChatQuota({
			cookies: "c=1",
			transport: { get: vi.fn().mockRejectedValue(new Error("network")) },
		});
		expect(fail.status).toBe("error");
		expect(fail.lastError).toContain("network");
	});
});

describe("T3Chat quota route", () => {
	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-t3chat-quota-"));
		process.env.DATA_DIR = tempDir;
		vi.resetModules();
		vi.doMock("next/server", () => ({
			NextResponse: {
				json(body, init = {}) {
					return new Response(JSON.stringify(body), {
						status: init.status || 200,
						headers: { "Content-Type": "application/json" },
					});
				},
			},
		}));
	});

	afterEach(() => {
		vi.doUnmock("next/server");
		vi.resetModules();
		if (originalDataDir === undefined) delete process.env.DATA_DIR;
		else process.env.DATA_DIR = originalDataDir;
	});

	it("refreshes quota for one connection and stores providerSpecificData.t3chatQuota", async () => {
		const quota = { status: "ok", lastCheckedAt: 123, data: { balance: 7 } };
		vi.doMock("../../src/lib/t3chat/quota.js", async (importOriginal) => ({
			...(await importOriginal()),
			fetchT3ChatQuota: vi.fn().mockResolvedValue(quota),
		}));

		const { createProviderConnection, getProviderConnectionById } =
			await import("../../src/models/index.js");
		const conn = await createProviderConnection({
			provider: "t3chat",
			authType: "cookie",
			name: "T3",
			apiKey: "",
			providerSpecificData: { cookies: "c=1", convexSessionId: "convex" },
			isActive: true,
		});

		const { POST } = await import(
			"../../src/app/api/providers/t3chat/quota/route.js"
		);
		const res = await POST(
			new Request("https://9router.local/api/providers/t3chat/quota", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ connectionId: conn.id }),
			}),
		);
		const body = await res.json();
		const updated = await getProviderConnectionById(conn.id);

		expect(res.status).toBe(200);
		expect(body.results[0]).toMatchObject({ connectionId: conn.id, quota });
		expect(updated.providerSpecificData.t3chatQuota).toEqual(quota);
	});
});
