import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync } from "node:zlib";

const clientDir = resolve(import.meta.dirname, "../dist/client");
const entries = readdirSync(clientDir, { recursive: true, withFileTypes: true });
const rows = [
	"## Client build assets",
	"",
	"All emitted JS and CSS files in `dist/client`.",
	"",
	"| Asset | Files | Raw bytes | Brotli bytes |",
	"| --- | ---: | ---: | ---: |",
];

for (const [label, extension] of [
	["JavaScript", /\.[cm]?js$/],
	["CSS", /\.css$/],
] as const) {
	let files = 0;
	let rawBytes = 0;
	let brotliBytes = 0;

	for (const entry of entries) {
		if (!entry.isFile() || !extension.test(entry.name)) continue;
		const content = readFileSync(join(entry.parentPath, entry.name));
		files += 1;
		rawBytes += content.length;
		brotliBytes += brotliCompressSync(content).length;
	}

	rows.push(`| ${label} | ${files} | ${rawBytes} | ${brotliBytes} |`);
}

console.log(rows.join("\n"));
