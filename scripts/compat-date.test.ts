/**
 * Guards the committed `compatibility_date` against the installed runtimes.
 *
 * workerd refuses a Worker dated past what it knows, and `astro check`, the build
 * and `astro dev` each start one — so a hand bump past the oldest installed runtime
 * breaks them, or turns on behaviour that never ran locally. The weekly job caps
 * its own bumps; this catches the ones made by hand. Same invariant as
 * saas-on-cf's scripts/compatibility-dates.test.ts.
 *
 * It reads repository state, so it asks pnpm what is installed, the way
 * repo-hygiene.test.ts asks git what is tracked.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { installedRuntimes } from "./compat-date";
import { readCompatibilityDate } from "./compat-date-lib";

const ROOT = resolve(import.meta.dirname, "..");

describe("wrangler.jsonc compatibility_date", () => {
	it("is no newer than the oldest installed workerd supports", async () => {
		const current = readCompatibilityDate(readFileSync(resolve(ROOT, "wrangler.jsonc"), "utf8"));
		const runtimes = await installedRuntimes(ROOT);
		const [oldest] = runtimes.map((runtime) => runtime.compatibilityDate).sort();
		const list = runtimes.map((r) => `workerd ${r.version} → ${r.compatibilityDate}`).join(", ");

		expect(oldest).toBeDefined();
		expect(
			current <= (oldest ?? ""),
			`${current} is newer than ${oldest}, the newest date every installed runtime supports (${list}). Refresh the package that pins the oldest (\`pnpm why workerd\`), or lower the date.`,
		).toBe(true);
	});
});
