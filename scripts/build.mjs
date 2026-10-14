// Bundles the plugin with esbuild.
//
// esbuild parses/transpiles TypeScript itself (including standard decorators) and does not use
// the TypeScript compiler API, so the build is decoupled from the `typescript` version. Type
// checking is handled separately by `tsc --noEmit` (see the "typecheck" script).
import { spawn } from "node:child_process";
import { build, context } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, "ai.opencode.streamdeck.sdPlugin/bin");
const watch = process.argv.includes("--watch");

/** Restarts the plugin in Stream Deck after a successful watch rebuild. */
const restartPlugin = {
	name: "restart-in-stream-deck",
	setup(pluginBuild) {
		pluginBuild.onEnd((result) => {
			if (result.errors.length > 0) {
				return;
			}

			spawn("streamdeck", ["restart", "ai.opencode.streamdeck"], {
				shell: process.platform === "win32",
				stdio: "inherit",
			}).on("error", () => {});
		});
	},
};

const options = {
	entryPoints: [resolve(root, "src/plugin.ts")],
	outfile: resolve(outdir, "plugin.js"),
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node20",
	minify: !watch,
	sourcemap: watch,
	logLevel: "info",
	// The SDK pulls in a CommonJS dependency (`ws`) that `require()`s Node builtins. In an ESM
	// bundle esbuild replaces those with a shim that throws unless a real `require` exists.
	banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
	plugins: watch ? [restartPlugin] : [],
};

mkdirSync(outdir, { recursive: true });
// The bundle lives next to its own package.json so it is treated as ESM when the .sdPlugin folder
// is packaged/distributed on its own.
writeFileSync(resolve(outdir, "package.json"), `{ "type": "module" }\n`);

if (watch) {
	const ctx = await context(options);
	await ctx.watch();
	console.log("esbuild: watching for changes…");
} else {
	await build(options);
}
