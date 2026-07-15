import { promises as fs } from "node:fs"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { describe, expect, test, vi } from "vitest"
import {
	parseCliArgs,
	parseConfirmationAnswer,
	toHelpMessage,
	toLoginOptions,
	toMissingAuthFileMessage,
	toMissingAuthFilePrompt,
	toOverwriteAuthFilePrompt,
	toServerOptions,
} from "../src/cli-app.js"
import { toStartupMessage } from "../src/cli-logging.js"
import { runOpenAIOAuthLogin } from "../src/login.js"

const isAddressInUseError = (
	error: unknown,
): error is Error & { code: string } =>
	error instanceof Error &&
	"code" in error &&
	(error as { code?: unknown }).code === "EADDRINUSE"

const listenOnLoopback = (
	server: ReturnType<typeof createServer>,
	port: number,
): Promise<void> =>
	new Promise((resolve, reject) => {
		server.once("error", reject)
		server.listen(port, "127.0.0.1", () => {
			server.off("error", reject)
			resolve()
		})
	})

const closeServer = (server: ReturnType<typeof createServer>): Promise<void> =>
	new Promise((resolve, reject) => {
		if (!server.listening) {
			resolve()
			return
		}

		server.close((error) => {
			if (error) {
				reject(error)
				return
			}
			resolve()
		})
	})

const canBindLoopback = async (port: number): Promise<boolean> => {
	const server = createServer()
	try {
		await listenOnLoopback(server, port)
		return true
	} catch (error) {
		if (isAddressInUseError(error)) {
			return false
		}
		throw error
	} finally {
		await closeServer(server)
	}
}

const toBase64Url = (value: unknown): string =>
	Buffer.from(JSON.stringify(value)).toString("base64url")

const createJwt = (payload: Record<string, unknown>): string =>
	[
		toBase64Url({ alg: "none", typ: "JWT" }),
		toBase64Url(payload),
		"signature",
	].join(".")

const waitForLoginUrl = async (messages: string[]): Promise<URL> => {
	const deadline = Date.now() + 2000
	while (Date.now() < deadline) {
		const message = messages.find((entry) =>
			entry.startsWith("OpenAI OAuth login URL: "),
		)
		if (message) {
			return new URL(message.replace("OpenAI OAuth login URL: ", ""))
		}
		await delay(10)
	}

	throw new Error("Timed out waiting for OpenAI OAuth login URL.")
}

describe("openai oauth cli", () => {
	test("parses kebab-case flags into server options", () => {
		const parsed = parseCliArgs([
			"--host",
			"0.0.0.0",
			"--port",
			"9999",
			"--models",
			"gpt-5.4,gpt-5.3-codex",
			"--codex-version",
			"0.114.0",
			"--base-url",
			"https://example.com/codex",
			"--oauth-client-id",
			"client-123",
			"--oauth-token-url",
			"https://auth.example.com/oauth/token",
			"--oauth-file",
			"/tmp/auth.json",
		])

		expect(toServerOptions(parsed)).toMatchObject({
			host: "0.0.0.0",
			port: 9999,
			models: ["gpt-5.4", "gpt-5.3-codex"],
			codexVersion: "0.114.0",
			baseURL: "https://example.com/codex",
			clientId: "client-123",
			tokenUrl: "https://auth.example.com/oauth/token",
			authFilePath: "/tmp/auth.json",
		})
	})

	test("parses login command options", () => {
		const parsed = parseCliArgs([
			"login",
			"--host",
			"127.0.0.1",
			"--port",
			"0",
			"--oauth-file",
			"/tmp/auth.json",
			"--no-open",
			"--login-timeout-ms",
			"1000",
		])

		expect(parsed.command).toBe("login")
		const loginOptions = toLoginOptions(parsed)
		expect(loginOptions).toMatchObject({
			authFilePath: "/tmp/auth.json",
			openBrowser: false,
			timeoutMs: 1000,
		})
		expect(loginOptions).not.toHaveProperty("host")
		expect(loginOptions).not.toHaveProperty("port")
	})

	test("parses detached serve flags", () => {
		expect(parseCliArgs(["--detach"])).toMatchObject({
			command: "serve",
			detach: true,
		})
		expect(parseCliArgs(["-d"])).toMatchObject({
			command: "serve",
			detach: true,
		})
	})

	test("parses logs command follow flags", () => {
		expect(parseCliArgs(["logs"])).toMatchObject({
			command: "logs",
			follow: false,
		})
		expect(parseCliArgs(["logs", "--follow"])).toMatchObject({
			command: "logs",
			follow: true,
		})
		expect(parseCliArgs(["logs", "-f"])).toMatchObject({
			command: "logs",
			follow: true,
		})
	})

	test("parses stop command", () => {
		expect(parseCliArgs(["stop"])).toMatchObject({
			command: "stop",
		})
	})

	test("parses status command", () => {
		expect(parseCliArgs(["status"])).toMatchObject({
			command: "status",
		})
	})

	test("parses but does not document the internal detached child flag", () => {
		expect(parseCliArgs(["--internal-detached-child"])).toMatchObject({
			command: "serve",
			internalDetachedChild: true,
		})
		expect(toHelpMessage()).not.toContain("internal-detached-child")
	})

	test("documents background lifecycle commands and flags", () => {
		const help = toHelpMessage()

		expect(help).toContain("npx openai-oauth@latest --detach [options]")
		expect(help).toContain("npx openai-oauth@latest status")
		expect(help).toContain("npx openai-oauth@latest logs [--follow]")
		expect(help).toContain("npx openai-oauth@latest stop")
		expect(help).toContain("-d, --detach")
		expect(help).toContain("-f, --follow")
	})

	test("does not reuse server host and port for automatic login", () => {
		const parsed = parseCliArgs([
			"--host",
			"0.0.0.0",
			"--port",
			"9999",
			"--oauth-file",
			"/tmp/auth.json",
		])

		expect(parsed.command).toBe("serve")
		expect(toServerOptions(parsed)).toMatchObject({
			host: "0.0.0.0",
			port: 9999,
		})
		const loginOptions = toLoginOptions(parsed)
		expect(loginOptions).toMatchObject({
			authFilePath: "/tmp/auth.json",
		})
		expect(loginOptions).not.toHaveProperty("host")
		expect(loginOptions).not.toHaveProperty("port")
	})

	test("drops empty model entries", () => {
		const parsed = parseCliArgs(["--models", "gpt-5.4, ,gpt-5.2,,"])
		expect(parsed.models).toEqual(["gpt-5.4", "gpt-5.2"])
	})

	test("formats the default startup message for local usage", () => {
		expect(
			toStartupMessage("http://127.0.0.1:10531/v1", [
				"gpt-5.4",
				"gpt-5.3-codex",
			]),
		).toBe(
			[
				"OpenAI-compatible endpoint ready at http://127.0.0.1:10531/v1",
				"Use this as your OpenAI base URL. No API key is required.",
				"",
				"Available Models: gpt-5.4, gpt-5.3-codex",
			].join("\n"),
		)
	})

	test("formats a missing explicit auth file message", () => {
		expect(toMissingAuthFileMessage("/tmp/missing-auth.json")).toContain(
			"Run `npx openai-oauth login` and try again.",
		)
		expect(toMissingAuthFileMessage("/tmp/missing-auth.json")).toContain(
			"/tmp/missing-auth.json",
		)
	})

	test("formats missing auth prompt with write destination", () => {
		expect(toMissingAuthFilePrompt("/tmp/auth.json")).toBe(
			[
				"No OpenAI OAuth credentials were found.",
				"Sign in with ChatGPT now? This will write credentials to /tmp/auth.json.",
			].join("\n"),
		)
	})

	test("formats overwrite prompt with existing auth file", () => {
		expect(toOverwriteAuthFilePrompt("/tmp/auth.json")).toBe(
			[
				"OpenAI OAuth credentials already exist at /tmp/auth.json.",
				"Sign in with ChatGPT again and overwrite them?",
			].join("\n"),
		)
	})

	test("parses confirmation answers", () => {
		expect(parseConfirmationAnswer("", true)).toBe(true)
		expect(parseConfirmationAnswer("", false)).toBe(false)
		expect(parseConfirmationAnswer("yes", false)).toBe(true)
		expect(parseConfirmationAnswer("Y", false)).toBe(true)
		expect(parseConfirmationAnswer("no", true)).toBe(false)
		expect(parseConfirmationAnswer("anything else", true)).toBe(false)
	})

	test("does not use hidden environment variable overrides", () => {
		const originalHost = process.env.HOST
		const originalPort = process.env.PORT
		process.env.HOST = "0.0.0.0"
		process.env.PORT = "3333"

		try {
			expect(toServerOptions({})).toMatchObject({
				host: undefined,
				port: 10531,
				codexVersion: undefined,
			})
		} finally {
			if (originalHost === undefined) {
				delete process.env.HOST
			} else {
				process.env.HOST = originalHost
			}
			if (originalPort === undefined) {
				delete process.env.PORT
			} else {
				process.env.PORT = originalPort
			}
		}
	})

	test("uses the accepted default callback port", async () => {
		if (!(await canBindLoopback(1455))) {
			return
		}

		const messages: string[] = []
		await expect(
			runOpenAIOAuthLogin({
				authFilePath: "/tmp/openai-oauth-test-auth.json",
				openBrowser: false,
				timeoutMs: 1,
				onMessage: (message) => messages.push(message),
			}),
		).rejects.toThrow("timed out")

		expect(decodeURIComponent(messages.join("\n"))).toContain(
			"http://localhost:1455/auth/callback",
		)
	})

	test("saves credentials after a successful local callback", async () => {
		if (!(await canBindLoopback(1455))) {
			return
		}

		const root = await fs.mkdtemp(path.join(os.tmpdir(), "openai-oauth-cli-"))
		const authFilePath = path.join(root, "auth.json")
		const messages: string[] = []
		const idToken = createJwt({
			"https://api.openai.com/auth": { chatgpt_account_id: "acct-cli" },
		})
		const tokenFetch = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					access_token: "access-cli",
					refresh_token: "refresh-cli",
					id_token: idToken,
					expires_in: 3600,
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			)
		})

		try {
			const loginPromise = runOpenAIOAuthLogin({
				authFilePath,
				clientId: "client-cli",
				fetch: tokenFetch,
				openBrowser: false,
				timeoutMs: 5000,
				onMessage: (message) => messages.push(message),
			})
			const authorizationUrl = await waitForLoginUrl(messages)
			const redirectUri = authorizationUrl.searchParams.get("redirect_uri")
			const state = authorizationUrl.searchParams.get("state")

			expect(redirectUri).toBe("http://localhost:1455/auth/callback")
			expect(state).toBeTruthy()

			const callbackResponse = await fetch(
				`${redirectUri}?code=code-cli&state=${state}`,
			)
			const callbackHtml = await callbackResponse.text()
			expect(callbackResponse.ok).toBe(true)
			expect(callbackHtml).toContain("<title>OpenAI OAuth Sign-In</title>")
			expect(callbackHtml).toContain('class="wordmark"')
			expect(callbackHtml).toContain('<h1 id="title">Sign-in complete</h1>')

			const saved = await loginPromise
			expect(saved.path).toBe(authFilePath)
			expect(saved.auth.accountId).toBe("acct-cli")
			expect(messages).toContain(`Credentials saved to ${authFilePath}`)

			const [, tokenInit] = tokenFetch.mock.calls[0] ?? []
			expect(
				Object.fromEntries(new URLSearchParams(String(tokenInit?.body))),
			).toMatchObject({
				grant_type: "authorization_code",
				code: "code-cli",
				redirect_uri: "http://localhost:1455/auth/callback",
				client_id: "client-cli",
			})
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})

	test("closes the callback server when login is aborted", async () => {
		if (!(await canBindLoopback(1455))) {
			return
		}

		const abortController = new AbortController()
		const messages: string[] = []
		const loginPromise = runOpenAIOAuthLogin({
			authFilePath: "/tmp/openai-oauth-test-auth.json",
			openBrowser: false,
			timeoutMs: 5000,
			signal: abortController.signal,
			onMessage: (message) => messages.push(message),
		})

		await waitForLoginUrl(messages)
		abortController.abort()

		await expect(loginPromise).rejects.toThrow("login cancelled")
		expect(await canBindLoopback(1455)).toBe(true)
	})

	test("errors clearly when the default callback port is busy", async () => {
		if (!(await canBindLoopback(1455))) {
			return
		}

		const blocker = createServer((_req, res) => {
			res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
			res.end("busy")
		})

		try {
			await listenOnLoopback(blocker, 1455)
		} catch (error) {
			if (!isAddressInUseError(error)) {
				throw error
			}
		}

		const messages: string[] = []
		try {
			await expect(
				runOpenAIOAuthLogin({
					authFilePath: "/tmp/openai-oauth-test-auth.json",
					openBrowser: false,
					timeoutMs: 1,
					onMessage: (message) => messages.push(message),
				}),
			).rejects.toThrow("port 1455 is already in use")
		} finally {
			await closeServer(blocker)
		}

		expect(messages).toHaveLength(0)
	})
})
