#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)

const packageDirs = [
	"packages/core",
	"packages/local",
	"packages/web",
	"packages/openai-client",
	"packages/ai-sdk",
	"packages/react",
	"packages/openai-oauth",
]

for (const packageDir of packageDirs) {
	console.log(`\n> ${packageDir}`)

	const result = spawnSync("bun", ["publish", ...args], {
		cwd: join(root, packageDir),
		stdio: "inherit",
		env: process.env,
	})

	if (result.status !== 0) {
		process.exit(result.status ?? 1)
	}
}
