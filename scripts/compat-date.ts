#!/usr/bin/env tsx
/**
 * Plans the weekly `compatibility_date` bump for `.github/workflows/compat-date.yml`.
 *
 * The side-effecting half: it reads wrangler.jsonc, asks pnpm which workerd
 * runtimes are installed, loads each one's exported `compatibilityDate`, and hands
 * all of it to `compat-date-lib.ts`, which makes every decision. It writes nothing
 * in the repository. In CI it sets step outputs and the job summary; by hand
 * (`pnpm exec tsx scripts/compat-date.ts`) it prints the plan.
 *
 * `installedRuntimes` is exported for `compat-date.test.ts`, which holds the
 * committed date to the same cap.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execa } from "execa";
import {
	planCompatibilityDate,
	type Runtime,
	readCompatibilityDate,
	workerdPackages,
} from "./compat-date-lib";

const load = createRequire(import.meta.url);

/** Every installed workerd and the newest date it supports, as its package exports it. */
export async function installedRuntimes(root: string): Promise<Runtime[]> {
	const { stdout } = await execa("pnpm", ["ls", "workerd", "--depth", "99", "--json"], {
		cwd: root,
	});
	return workerdPackages(stdout).map(({ version, path }) => ({
		version,
		compatibilityDate: String((load(path) as { compatibilityDate?: unknown }).compatibilityDate),
	}));
}

async function main(): Promise<void> {
	const root = resolve(import.meta.dirname, "..");
	const staleThresholdDays = Number(process.env.STALE_THRESHOLD_DAYS ?? "90");
	const runtimes = await installedRuntimes(root);

	const plan = planCompatibilityDate({
		current: readCompatibilityDate(readFileSync(resolve(root, "wrangler.jsonc"), "utf8")),
		today: new Date().toISOString().slice(0, 10),
		runtimes,
		staleThresholdDays,
	});

	// `::warning` lines are workflow commands: shown on the run, without failing it.
	let decision: string;
	switch (plan.kind) {
		case "fresh":
			decision = `${plan.current} is ${plan.ageDays} days old, within ${staleThresholdDays}: nothing to do`;
			break;
		case "bump":
			decision = `bump ${plan.current} → ${plan.target} (${plan.ageDays} days old; limited by ${plan.limitedBy})`;
			if (plan.stillStale) {
				console.log(
					`::warning title=compatibility_date still stale::${plan.target} is still more than ${staleThresholdDays} days old. Refresh ${plan.limitedBy} (\`pnpm why workerd\`) to move it further`,
				);
			}
			break;
		case "blocked":
			decision = `${plan.current} is ${plan.ageDays} days old, but ${plan.limitedBy} supports nothing past ${plan.newestSupported}. Refresh the package that pins it (\`pnpm why workerd\`), then rerun`;
			console.log(`::warning title=compatibility_date cannot move::${decision}`);
			break;
	}
	console.log(`compatibility_date: ${decision}`);

	const outputs = {
		bump: String(plan.kind === "bump"),
		current: plan.current,
		age_days: String(plan.ageDays),
		...(plan.kind === "bump" ? { target: plan.target, limited_by: plan.limitedBy } : {}),
	};

	if (process.env.GITHUB_OUTPUT) {
		const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`);
		appendFileSync(process.env.GITHUB_OUTPUT, lines.join(""));
	}

	if (process.env.GITHUB_STEP_SUMMARY) {
		const rows = [
			["Current", `\`${plan.current}\``],
			["Age (days)", String(plan.ageDays)],
			["Threshold (days)", String(staleThresholdDays)],
			...runtimes.map(({ version, compatibilityDate }) => [
				`workerd ${version}`,
				`\`${compatibilityDate}\``,
			]),
			["Decision", decision],
		];
		appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			[
				"## compatibility_date",
				"",
				"| Field | Value |",
				"| --- | --- |",
				...rows.map(([field, value]) => `| ${field} | ${value} |`),
				"",
			].join("\n"),
		);
	}
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
	await main();
}
