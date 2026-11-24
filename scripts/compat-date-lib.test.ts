import {
	CompatDateError,
	planCompatibilityDate,
	readCompatibilityDate,
	workerdPackages,
} from "./compat-date-lib";

describe("readCompatibilityDate", () => {
	it("reads the date from JSONC with comments", () => {
		const source = `{
			// the runtime contract
			"name": "app",
			"compatibility_date": "2026-05-25" // bumped weekly
		}`;
		expect(readCompatibilityDate(source)).toBe("2026-05-25");
	});

	it.each([
		["missing", `{ "name": "app" }`],
		["not a string", `{ "compatibility_date": 20260525 }`],
		["not ISO", `{ "compatibility_date": "25-05-2026" }`],
		["not a calendar day", `{ "compatibility_date": "2026-02-30" }`],
	])("throws when the date is %s", (_label, source) => {
		expect(() => readCompatibilityDate(source)).toThrow(CompatDateError);
	});
});

describe("workerdPackages", () => {
	const ls = (dependencies: unknown) =>
		JSON.stringify([{ name: "app", path: "/repo", dependencies }]);

	it("collects every workerd in the tree, however deep, once each", () => {
		const workerd = (version: string) => ({ version, path: `/store/workerd@${version}` });
		const json = ls({
			"@astrojs/cloudflare": {
				dependencies: {
					"@cloudflare/vite-plugin": {
						dependencies: { miniflare: { dependencies: { workerd: workerd("1.20261117.1") } } },
					},
					wrangler: { dependencies: { workerd: workerd("1.20261119.1") } },
				},
			},
			wrangler: { dependencies: { workerd: workerd("1.20261119.1") } },
		});

		expect(workerdPackages(json)).toEqual([
			{ version: "1.20261117.1", path: "/store/workerd@1.20261117.1" },
			{ version: "1.20261119.1", path: "/store/workerd@1.20261119.1" },
		]);
	});

	it("throws when the tree has no workerd, rather than reading that as no limit", () => {
		expect(() => workerdPackages(ls({ astro: { version: "6.4.8", path: "/x" } }))).toThrow(
			CompatDateError,
		);
	});

	it("throws when pnpm printed something other than JSON", () => {
		expect(() => workerdPackages("ERR_PNPM_NO_LOCKFILE")).toThrow(CompatDateError);
	});
});

describe("planCompatibilityDate", () => {
	const runtime = (compatibilityDate: string, version = "1.x") => ({ version, compatibilityDate });
	const plan = (overrides: Partial<Parameters<typeof planCompatibilityDate>[0]>) =>
		planCompatibilityDate({
			current: "2026-05-25",
			today: "2026-11-23",
			runtimes: [runtime("2026-11-19")],
			staleThresholdDays: 90,
			...overrides,
		});

	it.each([
		["at the threshold", "2026-08-25", 90],
		["inside it", "2026-11-01", 22],
	])("leaves a date %s alone", (_label, current, ageDays) => {
		expect(plan({ current })).toEqual({ kind: "fresh", current, ageDays });
	});

	it("bumps to today when every runtime supports it", () => {
		expect(plan({ today: "2026-11-10" })).toEqual({
			kind: "bump",
			current: "2026-05-25",
			target: "2026-11-10",
			ageDays: 169,
			limitedBy: "today",
			stillStale: false,
		});
	});

	it("caps the bump at the oldest runtime", () => {
		expect(plan({ runtimes: [runtime("2026-11-17", "1.20261117.1")] })).toEqual({
			kind: "bump",
			current: "2026-05-25",
			target: "2026-11-17",
			ageDays: 182,
			limitedBy: "workerd 1.20261117.1",
			stillStale: false,
		});
	});

	it("flags a capped bump still past the threshold — the 2026-11-23 failure", () => {
		// The job bumped to today; the adapter's workerd 1.20260708 refused it.
		const result = plan({
			runtimes: [runtime("2026-07-30", "1.20260730.1"), runtime("2026-07-08", "1.20260708.1")],
		});
		expect(result).toEqual({
			kind: "bump",
			current: "2026-05-25",
			target: "2026-07-08",
			ageDays: 182,
			limitedBy: "workerd 1.20260708.1",
			stillStale: true,
		});
	});

	it("reports blocked when no runtime goes past the current date", () => {
		const result = plan({
			current: "2026-11-24",
			today: "2027-03-01",
			runtimes: [runtime("2026-11-17", "1.20261117.1"), runtime("2026-11-19", "1.20261119.1")],
		});
		expect(result).toEqual({
			kind: "blocked",
			current: "2026-11-24",
			ageDays: 97,
			newestSupported: "2026-11-17",
			limitedBy: "workerd 1.20261117.1",
		});
	});

	it.each([Number.NaN, -1, 1.5])("throws on a threshold of %s days", (staleThresholdDays) => {
		expect(() => plan({ staleThresholdDays })).toThrow(CompatDateError);
	});

	it("throws on a stale date with no runtime to cap it, rather than bumping uncapped", () => {
		expect(() => plan({ runtimes: [] })).toThrow(CompatDateError);
	});

	it.each([
		["a runtime", { runtimes: [runtime("undefined")] }],
		["today", { today: "2026-11-31" }],
		["the current date", { current: "May 25" }],
	])("throws when %s is not a calendar day", (_label, overrides) => {
		expect(() => plan(overrides)).toThrow(CompatDateError);
	});
});
