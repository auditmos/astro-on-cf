// @ts-check
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
	output: "server",
	adapter: cloudflare(),
	vite: {
		plugins: [tailwindcss()],
		// Emits .js.map alongside the Worker bundle. wrangler.jsonc sets
		// upload_source_maps so production stack traces resolve to source.
		build: { sourcemap: true },
	},
});
