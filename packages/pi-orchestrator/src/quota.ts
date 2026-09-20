/**
 * Multi-account discovery and live Quota / Rate-limit tracker
 * Fetches 5h and weekly limits with reset timestamps from Google Antigravity and xAI.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AccountLimits } from "./types.ts";

const DEFAULT_USER_AGENT =
	"antigravity/cli/1.1.23 (aidev_client; os_type=linux; arch=amd64; cl=974125021; auth_method=consumer)";
const DEFAULT_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";

export function formatResetCountdown(resetTime?: string): string {
	if (!resetTime) return "n/a";
	const ts = Date.parse(resetTime);
	if (!Number.isFinite(ts)) return resetTime;
	const delta = ts - Date.now();
	if (delta <= 0) return "ready / now";
	const totalMin = Math.round(delta / 60000);
	const days = Math.floor(totalMin / (60 * 24));
	const hours = Math.floor((totalMin % (60 * 24)) / 60);
	const mins = totalMin % 60;
	if (days > 0) return `in ${days}d ${hours}h`;
	if (hours > 0) return `in ${hours}h ${mins}m`;
	return `in ${mins}m`;
}

interface RawAuthItem {
	type?: string;
	access?: string;
	token?: string;
	refresh?: string;
	expires?: number;
	projectId?: string;
	email?: string;
}

interface MultiPassConfig {
	subscriptions?: Array<{
		provider: string;
		index: number;
		label?: string;
	}>;
}

export function getMasterCredentials(accountId = "antigravity"): string {
	try {
		const authPath = path.join(os.homedir(), ".pi", "agent", "auth.json");
		if (fs.existsSync(authPath)) {
			const auth = JSON.parse(fs.readFileSync(authPath, "utf-8")) as Record<string, RawAuthItem>;
			const cred = auth[accountId] || auth.antigravity;
			if (cred?.access) {
				return JSON.stringify({ token: cred.access, projectId: cred.projectId || "antigravity-default" });
			}
		}
	} catch {
		// ignore
	}
	return "";
}

export function getDiscoveredAccounts(): Array<{
	id: string;
	provider: "antigravity" | "xai" | "google" | "other";
	label?: string;
	email?: string;
	cred: RawAuthItem;
}> {
	const authPath = path.join(os.homedir(), ".pi", "agent", "auth.json");
	const multiPassPath = path.join(os.homedir(), ".pi", "agent", "multi-pass.json");

	if (!fs.existsSync(authPath)) return [];

	let auth: Record<string, RawAuthItem> = {};
	try {
		auth = JSON.parse(fs.readFileSync(authPath, "utf-8")) as Record<string, RawAuthItem>;
	} catch {
		return [];
	}

	let multiPass: MultiPassConfig = {};
	if (fs.existsSync(multiPassPath)) {
		try {
			multiPass = JSON.parse(fs.readFileSync(multiPassPath, "utf-8")) as MultiPassConfig;
		} catch {
			// ignore
		}
	}

	const labelsMap = new Map<string, string>();
	for (const sub of multiPass.subscriptions || []) {
		const key = `${sub.provider}-${sub.index}`;
		if (sub.label) {
			labelsMap.set(key, sub.label);
			labelsMap.set(key.replace("google-", ""), sub.label);
		}
	}

	const accounts: Array<{
		id: string;
		provider: "antigravity" | "xai" | "google" | "other";
		label?: string;
		email?: string;
		cred: RawAuthItem;
	}> = [];

	for (const [id, cred] of Object.entries(auth)) {
		let provider: "antigravity" | "xai" | "google" | "other" = "other";
		if (id.includes("antigravity")) {
			provider = "antigravity";
		} else if (id === "xai") {
			provider = "xai";
		} else if (id.includes("google")) {
			provider = "google";
		}

		let label = labelsMap.get(id);
		if (!label && cred.email) label = cred.email;
		if (!label && id === "antigravity") label = "Master #1";

		accounts.push({
			id,
			provider,
			label,
			email: cred.email,
			cred,
		});
	}

	return accounts;
}

// In-memory cache for live quota information
const quotaCache = new Map<string, { limits: AccountLimits; expiresAt: number }>();
const CACHE_TTL_MS = 45 * 1000; // 45 seconds

export async function fetchLiveAccountLimits(accountId: string, forceRefresh = false): Promise<AccountLimits> {
	if (!forceRefresh) {
		const cached = quotaCache.get(accountId);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.limits;
		}
	}

	const accounts = getDiscoveredAccounts();
	const acc = accounts.find((a) => a.id === accountId);
	if (!acc) {
		return {
			accountId,
			provider: "other",
			role: "idle",
			enabled: false,
			isMaster: false,
			isSecurityAuditor: false,
			status: "error",
			error: `Account ${accountId} not found in ~/.pi/agent/auth.json`,
		};
	}

	const token = acc.cred.access || acc.cred.token;
	if (!token) {
		return {
			accountId,
			provider: acc.provider,
			label: acc.label,
			role: "idle",
			enabled: false,
			isMaster: false,
			isSecurityAuditor: false,
			status: "error",
			error: "No access token found",
		};
	}

	const baseLimits: AccountLimits = {
		accountId,
		provider: acc.provider,
		label: acc.label,
		role: "worker",
		enabled: true,
		isMaster: false,
		isSecurityAuditor: false,
		lastUpdated: Date.now(),
		status: "active",
	};

	// Handling xAI
	if (acc.provider === "xai") {
		const expires = acc.cred.expires ? Number(acc.cred.expires) : undefined;
		const isExpired = expires ? expires < Date.now() : false;
		baseLimits.planLabel = "xAI Grok Platform (Tier 1)";
		baseLimits.status = isExpired ? "cooling_down" : "active";
		baseLimits.fiveHourReset = expires ? formatResetCountdown(new Date(expires).toISOString()) : "ready";
		quotaCache.set(accountId, { limits: baseLimits, expiresAt: Date.now() + CACHE_TTL_MS });
		return baseLimits;
	}

	// Handling Antigravity / Google
	try {
		// 1. Try retrieveUserQuotaSummary
		const summaryRes = await fetch(`${DEFAULT_ENDPOINT}/v1internal:retrieveUserQuotaSummary`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				"User-Agent": DEFAULT_USER_AGENT,
			},
			body: "{}",
		});

		if (summaryRes.ok) {
			const data = (await summaryRes.json()) as {
				groups?: Array<{
					displayName?: string;
					buckets?: Array<{
						displayName?: string;
						window?: string;
						remainingFraction?: number;
						resetTime?: string;
					}>;
				}>;
			};

			let fiveHourFraction: number | undefined;
			let weeklyFraction: number | undefined;
			let fiveHourReset: string | undefined;
			let weeklyReset: string | undefined;

			for (const group of data.groups || []) {
				for (const bucket of group.buckets || []) {
					const window = (bucket.window || "").toLowerCase();
					const name = (bucket.displayName || "").toLowerCase();

					if (window === "5h" || name.includes("five hour") || name.includes("5h") || name.includes("5-hour")) {
						if (bucket.remainingFraction !== undefined) {
							// Pick minimum or first available
							fiveHourFraction = bucket.remainingFraction;
							fiveHourReset = formatResetCountdown(bucket.resetTime);
						}
					} else if (window === "weekly" || name.includes("week")) {
						if (bucket.remainingFraction !== undefined) {
							weeklyFraction = bucket.remainingFraction;
							weeklyReset = formatResetCountdown(bucket.resetTime);
						}
					}
				}
			}

			baseLimits.planLabel = "Google AI Pro (g1-pro-tier)";
			baseLimits.fiveHourRemaining =
				fiveHourFraction !== undefined ? Math.round(fiveHourFraction * 1000) / 10 : undefined;
			baseLimits.weeklyRemaining = weeklyFraction !== undefined ? Math.round(weeklyFraction * 1000) / 10 : undefined;
			baseLimits.fiveHourReset = fiveHourReset || "ready";
			baseLimits.weeklyReset = weeklyReset || "ready";

			if (baseLimits.fiveHourRemaining !== undefined && baseLimits.fiveHourRemaining <= 0) {
				baseLimits.status = "rate_limited";
			}

			quotaCache.set(accountId, { limits: baseLimits, expiresAt: Date.now() + CACHE_TTL_MS });
			return baseLimits;
		}

		// 2. Fallback to fetchAvailableModels if summary is restricted (e.g. 403 on sub-accounts)
		const modelsRes = await fetch(`${DEFAULT_ENDPOINT}/v1internal:fetchAvailableModels`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				"User-Agent": DEFAULT_USER_AGENT,
			},
			body: JSON.stringify({ project: acc.cred.projectId || "antigravity-default" }),
		});

		if (modelsRes.ok) {
			const mData = (await modelsRes.json()) as {
				models?: Record<
					string,
					{
						quotaInfo?: {
							remainingFraction?: number;
							resetTime?: string;
						};
					}
				>;
			};

			const modelsList: Array<{
				modelId: string;
				remainingFraction: number;
				resetTime?: string;
				resetFormatted: string;
			}> = [];

			let avgRemaining = 0;
			let count = 0;
			let earliestReset: string | undefined;

			for (const [modelId, info] of Object.entries(mData.models || {})) {
				if (info?.quotaInfo?.remainingFraction !== undefined) {
					const rem = info.quotaInfo.remainingFraction;
					avgRemaining += rem;
					count++;
					modelsList.push({
						modelId,
						remainingFraction: rem,
						resetTime: info.quotaInfo.resetTime,
						resetFormatted: formatResetCountdown(info.quotaInfo.resetTime),
					});
					if (!earliestReset && info.quotaInfo.resetTime) {
						earliestReset = formatResetCountdown(info.quotaInfo.resetTime);
					}
				}
			}

			const remainingPct = count > 0 ? Math.round((avgRemaining / count) * 1000) / 10 : 100;
			baseLimits.planLabel = "Google Antigravity Subscription";
			baseLimits.fiveHourRemaining = remainingPct;
			baseLimits.weeklyRemaining = 100;
			baseLimits.fiveHourReset = earliestReset || "ready";
			baseLimits.weeklyReset = "ready";
			baseLimits.modelsQuota = modelsList.slice(0, 10);

			quotaCache.set(accountId, { limits: baseLimits, expiresAt: Date.now() + CACHE_TTL_MS });
			return baseLimits;
		}

		// If both failed
		baseLimits.status = "error";
		baseLimits.error = `HTTP ${summaryRes.status} / ${modelsRes.status}`;
		return baseLimits;
	} catch (err) {
		baseLimits.status = "error";
		baseLimits.error = err instanceof Error ? err.message : String(err);
		return baseLimits;
	}
}

export async function fetchAllAccountLimits(forceRefresh = false): Promise<AccountLimits[]> {
	const accounts = getDiscoveredAccounts();
	const results = await Promise.all(
		accounts.map(async (acc) => {
			return await fetchLiveAccountLimits(acc.id, forceRefresh);
		}),
	);
	return results;
}
