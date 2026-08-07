/**
 * Contract test for the claims the repository makes about itself (issue #22).
 *
 * Two failure modes are covered, both of which had already happened:
 *
 * 1. **Dead pointers.** The project doc named `/docs` as the single source of
 *    truth for business requirements while no such directory existed, and
 *    listed `src/components/` in a tree that did not contain it. A documented
 *    source of truth nobody can open is worse than no pointer at all.
 * 2. **Copied literals.** The README embedded the Worker configuration verbatim,
 *    including a `compatibility_date` the weekly dependency bot bumps. Every bump
 *    made the README staler. The fix is to delete the copy rather than to sync it:
 *    teaching the bot to rewrite prose automates a problem better removed, and a
 *    drift test would turn every legitimate config edit into a two-file edit.
 *
 * **Scope.** A "pointer" here is a backticked token rooted in one of the tracked
 * directories, or a relative markdown link target. Package names, shell commands
 * and gitignored env files are deliberately out of scope — they are not claims
 * about the tree. The `--with-db` section is excluded because it describes what
 * `init-project --with-db` scaffolds, not what is present.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const README = readFileSync(resolve(ROOT, "README.md"), "utf8");
const PROJECT_DOC = readFileSync(resolve(ROOT, "AGENTS.md"), "utf8");

/** Directories whose contents are tracked, so a pointer into them is a checkable claim. */
const TRACKED_ROOTS = ["src", "scripts", "public", ".claude", "docs"];

/** Sections describing optional scaffolding rather than the tree as it stands. */
const CONDITIONAL_SECTIONS = ["Optional: Drizzle + Neon data layer"];

function withoutConditionalSections(doc: string): string {
	return CONDITIONAL_SECTIONS.reduce((text, heading) => {
		const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return text.replace(new RegExp(`\\n## ${escaped}\\n[\\s\\S]*?(?=\\n## |$)`), "\n");
	}, doc);
}

/** A glob or placeholder describes a set; the directory holding it is the claim. */
function literalPrefix(path: string): string {
	const cut = path.search(/[*{[<]/);
	if (cut === -1) return path;
	return path.slice(0, path.lastIndexOf("/", cut) + 1);
}

function pointersIn(doc: string): string[] {
	const text = withoutConditionalSections(doc);

	const backticked = [...text.matchAll(/`\/?([^`\s]+)`/g)]
		.map((match) => match[1] as string)
		.filter((token) =>
			TRACKED_ROOTS.some((root) => token === root || token.startsWith(`${root}/`)),
		);

	const linked = [...text.matchAll(/\]\(([^)#\s]+)\)/g)]
		.map((match) => (match[1] as string).replace(/^\.\//, ""))
		.filter((target) => !/^[a-z][a-z+.-]*:/.test(target));

	return [...new Set([...backticked, ...linked])].map(literalPrefix).filter((path) => path !== "");
}

/** Reconstructs full paths from an ASCII tree block, tracking indent depth. */
function pathsInTree(block: string): string[] {
	const lines = block.split("\n");
	const stack = [(lines[0] ?? "").trim()];
	const paths: string[] = [];

	for (const line of lines.slice(1)) {
		const match = line.match(/^((?:(?:│| ) {3})*)(?:├──|└──) (\S+)/);
		if (!match) continue;
		const depth = (match[1] as string).length / 4 + 1;
		stack.length = depth;
		stack[depth] = match[2] as string;
		paths.push(stack.join(""));
	}

	return paths;
}

function treeBlockUnder(doc: string, heading: string): string {
	const match = doc.match(new RegExp(`## ${heading}\\n+\`\`\`[a-z]*\\n([\\s\\S]*?)\`\`\``));
	return match?.[1] ?? "";
}

describe.each([
	["AGENTS.md", PROJECT_DOC],
	["README.md", README],
])("%s pointers", (_name, doc) => {
	const pointers = pointersIn(doc);

	it("points at something", () => {
		expect(pointers.length).toBeGreaterThan(0);
	});

	it("resolves every pointer to a path that exists", () => {
		expect(pointers.filter((path) => !existsSync(resolve(ROOT, path)))).toEqual([]);
	});
});

describe("requirements directory", () => {
	it("exists, so the documented source of truth can be opened", () => {
		expect(existsSync(resolve(ROOT, "docs"))).toBe(true);
	});

	it("carries a stub describing what belongs there", () => {
		const stub = resolve(ROOT, "docs", "README.md");
		expect(existsSync(stub)).toBe(true);
		expect(readFileSync(stub, "utf8").length).toBeGreaterThan(200);
	});

	it("is named by the project doc as the source of truth for requirements", () => {
		expect(PROJECT_DOC).toMatch(/`\/?docs\/?`/);
	});
});

describe("README structure claim", () => {
	const paths = pathsInTree(treeBlockUnder(README, "Project Structure"));

	it("draws a tree", () => {
		expect(paths.length).toBeGreaterThan(0);
	});

	it("names only directories and files that are actually present", () => {
		expect(paths.filter((path) => !existsSync(resolve(ROOT, path)))).toEqual([]);
	});
});

describe("README Worker configuration", () => {
	it("quotes no compatibility date for the weekly bot to make stale", () => {
		expect(README).not.toMatch(/compatibility_date/);
	});

	it("reproduces no fenced copy of the Worker configuration", () => {
		const fences = [...README.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map(
			(match) => match[1] as string,
		);
		const copies = fences.filter(
			(fence) => fence.includes('"$schema"') || fence.includes('"compatibility_flags"'),
		);
		expect(copies).toEqual([]);
	});

	it("links wrangler.jsonc as the source of truth instead", () => {
		expect(README).toMatch(/\]\(\.\/wrangler\.jsonc\)/);
	});
});
