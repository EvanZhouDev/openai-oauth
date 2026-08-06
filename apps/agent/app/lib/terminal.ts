import { spawn } from "node:child_process"
import path from "node:path"
import { resolveInWorkspace, sessionRoot } from "./workspace"

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 300_000
const MAX_OUTPUT_CHARS = 20_000

export type TerminalResult = {
	command: string
	cwd: string
	exitCode: number | null
	signal: string | null
	timedOut: boolean
	durationMs: number
	stdout: string
	stderr: string
	truncated: boolean
}

/**
 * Commands that would reach past the sandbox directory or take down the host.
 * This is a guard rail on top of the path jail, not a security boundary: the
 * terminal runs as a normal child process on the server, so deploy the app
 * inside a container if you expose it to anyone but yourself.
 */
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{
		pattern: /\brm\s+(-[a-zA-Z]*\s+)*(\/|\/\*|~|\$HOME)(\s|$)/,
		reason: "deletes files outside the sandbox",
	},
	{ pattern: /\bmkfs(\.|\s)/, reason: "formats a filesystem" },
	{
		pattern: /\bdd\b[^\n]*\bof=\/dev\//,
		reason: "writes directly to a device",
	},
	{
		pattern: /\b(shutdown|reboot|halt|poweroff)\b/,
		reason: "controls the host machine",
	},
	{ pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: "is a fork bomb" },
	{ pattern: /\bsudo\b|\bsu\s+-/, reason: "escalates privileges" },
	{
		pattern: /(^|[\s;&|])(>|>>)\s*\/(etc|usr|bin|sbin|boot|dev|proc|sys)\//,
		reason: "writes to a system directory",
	},
	{ pattern: /\bchmod\s+-R\s+777\s+\//, reason: "changes host permissions" },
]

const truncate = (value: string): { text: string; truncated: boolean } =>
	value.length > MAX_OUTPUT_CHARS
		? {
				text: `${value.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated (${value.length - MAX_OUTPUT_CHARS} more characters)`,
				truncated: true,
			}
		: { text: value, truncated: false }

export const checkCommandAllowed = (command: string): string | null => {
	for (const { pattern, reason } of BLOCKED_PATTERNS) {
		if (pattern.test(command)) {
			return `Refused to run this command because it ${reason}. The sandbox terminal only operates inside the conversation workspace.`
		}
	}
	return null
}

export type RunCommandOptions = {
	sessionId: string
	command: string
	cwd?: string
	timeoutMs?: number
	signal?: AbortSignal
}

export const runCommand = async ({
	sessionId,
	command,
	cwd = ".",
	timeoutMs = DEFAULT_TIMEOUT_MS,
	signal,
}: RunCommandOptions): Promise<TerminalResult> => {
	const blocked = checkCommandAllowed(command)
	if (blocked) {
		throw new Error(blocked)
	}

	const root = await sessionRoot(sessionId)
	const { absolute, relative } = await resolveInWorkspace(sessionId, cwd)
	const limit = Math.min(Math.max(timeoutMs, 1_000), MAX_TIMEOUT_MS)
	const startedAt = Date.now()

	// Deliberately minimal environment: nothing from the server process leaks
	// into the sandbox except PATH and the locale.
	const env: Record<string, string> = {
		PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
		HOME: root,
		TMPDIR: path.join(root, ".tmp"),
		LANG: process.env.LANG ?? "C.UTF-8",
		TERM: "dumb",
		PWD: absolute,
		CI: "1",
		NO_COLOR: "1",
	}

	// `AGENT_SANDBOX_COMMAND` swaps the shell for a container or jail wrapper,
	// e.g. "docker run --rm -i -v …:/work -w /work node:22 bash -lc".
	const launcher = (process.env.AGENT_SANDBOX_COMMAND ?? "bash -lc")
		.split(" ")
		.filter((part) => part.length > 0)
	const [program, ...launcherArgs] = launcher as [string, ...string[]]

	return await new Promise<TerminalResult>((resolve, reject) => {
		const child = spawn(program, [...launcherArgs, command], {
			cwd: absolute,
			// Next augments ProcessEnv with required keys the sandbox must not inherit.
			env: env as unknown as NodeJS.ProcessEnv,
			stdio: ["ignore", "pipe", "pipe"] as const,
		})

		let stdout = ""
		let stderr = ""
		let timedOut = false
		let settled = false

		const killTimer = setTimeout(() => {
			timedOut = true
			child.kill("SIGTERM")
			setTimeout(() => child.kill("SIGKILL"), 2_000).unref?.()
		}, limit)

		const onAbort = () => {
			child.kill("SIGKILL")
		}
		signal?.addEventListener("abort", onAbort, { once: true })

		const finish = (result: TerminalResult) => {
			if (settled) {
				return
			}
			settled = true
			clearTimeout(killTimer)
			signal?.removeEventListener("abort", onAbort)
			resolve(result)
		}

		child.stdout.on("data", (chunk: Buffer) => {
			if (stdout.length < MAX_OUTPUT_CHARS * 2) {
				stdout += chunk.toString("utf8")
			}
		})
		child.stderr.on("data", (chunk: Buffer) => {
			if (stderr.length < MAX_OUTPUT_CHARS * 2) {
				stderr += chunk.toString("utf8")
			}
		})

		child.on("error", (error) => {
			if (settled) {
				return
			}
			settled = true
			clearTimeout(killTimer)
			signal?.removeEventListener("abort", onAbort)
			reject(error)
		})

		child.on("close", (code, closeSignal) => {
			const out = truncate(stdout)
			const err = truncate(stderr)
			finish({
				command,
				cwd: relative,
				exitCode: code,
				signal: closeSignal,
				timedOut,
				durationMs: Date.now() - startedAt,
				stdout: out.text,
				stderr: err.text,
				truncated: out.truncated || err.truncated,
			})
		})
	})
}
