/**
 * Pure half of the weekly `compatibility_date` bump.
 *
 * The job used to bump straight to today. From 2026-10-19 it failed every week:
 * the adapter's transitive `@cloudflare/vite-plugin` ran workerd 1.20260708, which
 * refuses any date past its own, and `astro check` starts that runtime. taze moves
 * direct dependencies only, so nothing ever refreshed it.
 *
 * So the target is the earlier of today and the oldest installed workerd's
 * `compatibilityDate` — the date every runtime that builds, checks or serves this
 * Worker accepts. When no runtime reaches past the current date, the plan says so
 * instead of failing: the fix then is a runtime refresh, not a date.
 *
 * `compat-date.ts` does the I/O; nothing here touches the filesystem or a process.
 */

import { stripJsonc } from "./init-project-lib";

/** Raised when an input is not the shape this module can reason about. */
export class CompatDateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CompatDateError";
	}
}

export interface WorkerdPackage {
	readonly version: string;
	readonly path: string;
}

export interface Runtime {
	readonly version: string;
	/** What the workerd package exports as `compatibilityDate`. */
	readonly compatibilityDate: string;
}

export interface PlanInput {
	readonly current: string;
	readonly today: string;
	readonly runtimes: readonly Runtime[];
	readonly staleThresholdDays: number;
}

export type CompatDatePlan =
	| { readonly kind: "fresh"; readonly current: string; readonly ageDays: number }
	| {
			readonly kind: "bump";
			readonly current: string;
			readonly target: string;
			readonly ageDays: number;
			/** `today`, or the workerd that capped the target. */
			readonly limitedBy: string;
			/** The capped target is itself past the threshold: the runtime needs a refresh. */
			readonly stillStale: boolean;
	  }
	| {
			readonly kind: "blocked";
			readonly current: string;
			readonly ageDays: number;
			readonly newestSupported: string;
			readonly limitedBy: string;
	  };

const DAY_MS = 86_400_000;

/** Epoch ms of a `YYYY-MM-DD` that names a real calendar day, else a `CompatDateError`. */
function dayOf(date: string, what: string): number {
	const ms = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
	// Date.parse rolls 2026-02-30 over to March; the round trip catches it.
	if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
		throw new CompatDateError(`${what} is not a YYYY-MM-DD calendar day: ${JSON.stringify(date)}`);
	}
	return ms;
}

/** The `compatibility_date` of a wrangler.jsonc source. */
export function readCompatibilityDate(wranglerSource: string): string {
	let config: unknown;
	try {
		config = JSON.parse(stripJsonc(wranglerSource));
	} catch {
		throw new CompatDateError("wrangler.jsonc is not valid JSONC");
	}
	const date =
		typeof config === "object" && config !== null && "compatibility_date" in config
			? config.compatibility_date
			: undefined;
	if (typeof date !== "string") {
		throw new CompatDateError("wrangler.jsonc has no string compatibility_date");
	}
	dayOf(date, "compatibility_date");
	return date;
}

function collectWorkerd(node: unknown, found: Map<string, WorkerdPackage>): void {
	if (Array.isArray(node)) {
		for (const child of node) collectWorkerd(child, found);
		return;
	}
	if (typeof node !== "object" || node === null) return;

	for (const [key, value] of Object.entries(node)) {
		if (
			key === "workerd" &&
			typeof value === "object" &&
			value !== null &&
			"version" in value &&
			"path" in value &&
			typeof value.version === "string" &&
			typeof value.path === "string"
		) {
			found.set(value.path, { version: value.version, path: value.path });
		}
		collectWorkerd(value, found);
	}
}

/**
 * Every workerd install in `pnpm ls workerd --depth 99 --json`, once each.
 *
 * An empty result throws: a tree without workerd would leave the plan with no
 * runtime to cap the date by, and "found none" must not read as "no limit".
 */
export function workerdPackages(pnpmLsJson: string): WorkerdPackage[] {
	let tree: unknown;
	try {
		tree = JSON.parse(pnpmLsJson);
	} catch {
		throw new CompatDateError(
			`pnpm ls printed no JSON. First 200 characters: ${pnpmLsJson.slice(0, 200) || "(empty)"}`,
		);
	}

	const found = new Map<string, WorkerdPackage>();
	collectWorkerd(tree, found);
	if (found.size === 0) {
		throw new CompatDateError("pnpm ls found no workerd in the dependency tree");
	}
	return [...found.values()].sort((left, right) => left.version.localeCompare(right.version));
}

/** Whether to bump `compatibility_date`, and to what. */
export function planCompatibilityDate(input: PlanInput): CompatDatePlan {
	const { current, today, runtimes, staleThresholdDays } = input;
	// NaN would compare false against every age and mark every date stale.
	if (!Number.isInteger(staleThresholdDays) || staleThresholdDays < 0) {
		throw new CompatDateError(
			`stale threshold is not a whole number of days: ${staleThresholdDays}`,
		);
	}
	const currentMs = dayOf(current, "compatibility_date");
	const todayMs = dayOf(today, "today");
	const oldest = runtimes
		.map((runtime) => ({
			...runtime,
			ms: dayOf(runtime.compatibilityDate, `workerd ${runtime.version} compatibilityDate`),
		}))
		.sort((left, right) => left.ms - right.ms)[0];
	if (!oldest) {
		throw new CompatDateError("no workerd runtime to cap the date by");
	}

	const ageDays = Math.round((todayMs - currentMs) / DAY_MS);
	if (ageDays <= staleThresholdDays) return { kind: "fresh", current, ageDays };

	const runtimeLimit = `workerd ${oldest.version}`;
	if (oldest.ms <= currentMs) {
		return {
			kind: "blocked",
			current,
			ageDays,
			newestSupported: oldest.compatibilityDate,
			limitedBy: runtimeLimit,
		};
	}

	if (oldest.ms >= todayMs) {
		return { kind: "bump", current, target: today, ageDays, limitedBy: "today", stillStale: false };
	}
	return {
		kind: "bump",
		current,
		target: oldest.compatibilityDate,
		ageDays,
		limitedBy: runtimeLimit,
		stillStale: Math.round((todayMs - oldest.ms) / DAY_MS) > staleThresholdDays,
	};
}
