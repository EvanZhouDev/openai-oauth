#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const requestedArgs = process.argv.slice(2)

const packageDirs = [
	"packages/core",
	"packages/local",
	"packages/web",
	"packages/openai-client",
	"packages/ai-sdk",
	"packages/react",
	"packages/openai-oauth",
]
const version = JSON.parse(
	readFileSync(join(root, packageDirs[0], "package.json"), "utf8"),
).version
const hasTag = requestedArgs.some(
	(argument) => argument === "--tag" || argument.startsWith("--tag="),
)
const args =
	version.includes("-") && !hasTag
		? [...requestedArgs, "--tag", version.split("-")[1].split(".")[0]]
		: requestedArgs

const run = (command, commandArgs, cwd = root) => {
	const result = spawnSync(command, commandArgs, {
		cwd,
		stdio: "inherit",
		env: process.env,
	})

	if (result.status !== 0) {
		process.exit(result.status ?? 1)
	}
}

const publishAll = (publishArgs) => {
	for (const packageDir of packageDirs) {
		console.log(`\n> ${packageDir}`)
		run("bun", ["publish", ...publishArgs], join(root, packageDir))
	}
}

run("bun", ["run", "build"])
run("bun", ["run", "check:release"])

if (!args.includes("--dry-run")) {
	console.log("\nChecking every package before publishing...")
	publishAll([...args, "--dry-run"])
}

publishAll(args)
