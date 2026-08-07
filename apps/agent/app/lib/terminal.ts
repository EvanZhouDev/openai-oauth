import { spawn } from "node:child_process"
import path from "node:path"
import { resolveInWorkspace, sessionRoot } from "./workspace"

const DEFAULT_TIMEOUT_MS = 120_000
// Cloning a large repo or installing a dependency tree needs real time.
const MAX_TIMEOUT_MS = 900_000
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
		// /dev/null and friends are ordinary shell plumbing, so they stay allowed.
		pattern: /(^|[\s;&|])(>|>>)\s*\/(etc|usr|bin|sbin|boot|proc|sys)\//,
		reason: "writes to a system directory",
	},
	{ pattern: /\bchmod\s+-R\s+777\s+\//, reason: "changes host permissions" },
]

/**
 * Passed through so the sandbox inherits the host's connectivity: proxies, the
 * certificate bundle behind them, and the package-manager mirrors that go with
 * them. Nothing here carries credentials for the app's own account.
 */
const NETWORK_ENV_KEYS = [
	"ALL_PROXY",
	"all_proxy",
	"CURL_CA_BUNDLE",
	"GIT_SSL_CAINFO",
	"HTTP_PROXY",
	"http_proxy",
	"HTTPS_PROXY",
	"https_proxy",
	"NO_PROXY",
	"no_proxy",
	"NODE_EXTRA_CA_CERTS",
	"REQUESTS_CA_BUNDLE",
	"SSL_CERT_DIR",
	"SSL_CERT_FILE",
	"npm_config_registry",
	"COREPACK_ENABLE_DOWNLOAD_PROMPT",
] as const

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
		// Never sit waiting for credentials that nobody can type.
		GIT_TERMINAL_PROMPT: "0",
		GIT_ASKPASS: "",
		GCM_INTERACTIVE: "never",
		DEBIAN_FRONTEND: "noninteractive",
		PIP_DISABLE_PIP_VERSION_CHECK: "1",
		npm_config_audit: "false",
		npm_config_fund: "false",
		npm_config_progress: "false",
		npm_config_yes: "true",
	}

	// Proxy and certificate settings decide whether the sandbox has internet at
	// all. Copy whichever the host has set.
	for (const key of NETWORK_ENV_KEYS) {
		const value = process.env[key]
		if (typeof value === "string" && value.length > 0) {
			env[key] = value
		}
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
