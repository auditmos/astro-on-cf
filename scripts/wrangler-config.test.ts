/**
 * Contract test for the Worker runtime configuration.
 *
 * Observability (issue #4): Cloudflare's Workers best-practices doc calls out
 * sampling rate as a deliberate production knob. Defaulting works, but for a
 * template repo that may be deployed at meaningful traffic we surface the value
 * explicitly so future tuning is a one-character edit instead of a research task.
 *
 * Source maps (issue #19): observability being on while source map upload is off
 * is a half-configured state — traces arrive, but point at minified output. Both
 * halves are asserted here because uploading maps the build never emits is the
 * same defect wearing the opposite mask.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripJsonc } from "./init-project-lib";

const ROOT = resolve(import.meta.dirname, "..");

const wranglerConfig = JSON.parse(
	stripJsonc(readFileSync(resolve(ROOT, "wrangler.jsonc"), "utf8")),
) as {
	observability?: { enabled?: boolean; head_sampling_rate?: unknown };
	upload_source_maps?: boolean;
};

describe("wrangler.jsonc observability", () => {
	const observability = wranglerConfig.observability;

	it("is enabled", () => {
		expect(observability?.enabled).toBe(true);
	});

	it("declares head_sampling_rate explicitly", () => {
		expect(observability?.head_sampling_rate).toBeDefined();
	});

	it("sets head_sampling_rate to a number in (0, 1]", () => {
		const rate = observability?.head_sampling_rate;
		expect(typeof rate).toBe("number");
		expect(rate).toBeGreaterThan(0);
		expect(rate).toBeLessThanOrEqual(1);
	});
});

describe("source maps", () => {
	it("uploads source maps with the Worker", () => {
		expect(wranglerConfig.upload_source_maps).toBe(true);
	});

	it("emits source maps from the build, so the upload has something to carry", () => {
		const astroConfig = readFileSync(resolve(ROOT, "astro.config.mjs"), "utf8");
		expect(astroConfig).toMatch(/sourcemap:\s*true/);
	});
});
