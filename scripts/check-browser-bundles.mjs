#!/usr/bin/env bun
import { join } from "node:path"
import { build } from "esbuild"

const root = join(import.meta.dir, "..")
const entries = [
	"packages/core/src/index.ts",
	"packages/web/src/index.ts",
	"packages/react/src/index.ts",
	"packages/openai-client/src/index.ts",
	"packages/ai-sdk/src/index.ts",
]

for (const entry of entries) {
	await build({
		absWorkingDir: root,
		bundle: true,
		entryPoints: [entry],
		external: ["react", "react/jsx-runtime"],
		logLevel: "silent",
		platform: "browser",
		write: false,
	})
	console.log(`Browser bundle: ${entry}`)
}
