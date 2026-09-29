import { spawn } from "node:child_process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

export const resolveClaudeExecutable = (): string => {
	const report = process.report.getReport() as {
		header?: { glibcVersionRuntime?: string }
	}
	const musl =
		process.platform === "linux" && report.header?.glibcVersionRuntime == null
	const target = `${process.platform}-${process.arch}${musl ? "-musl" : ""}`
	const binary = process.platform === "win32" ? "claude.exe" : "claude"

	try {
		return require.resolve(`@anthropic-ai/claude-agent-sdk-${target}/${binary}`)
	} catch (cause) {
		throw new Error(
			`Claude login is not available for ${target}. Reinstall with optional dependencies enabled.`,
			{ cause },
		)
	}
}

export const runClaudeLogin = (): Promise<void> =>
	new Promise((resolve, reject) => {
		const child = spawn(
			resolveClaudeExecutable(),
			["auth", "login", "--claudeai"],
			{ stdio: "inherit" },
		)
		child.once("error", reject)
		child.once("exit", (code, signal) => {
			if (code === 0) {
				resolve()
			} else {
				reject(
					new Error(
						`Claude login exited with ${signal ?? `code ${code ?? "unknown"}`}.`,
					),
				)
			}
		})
	})
