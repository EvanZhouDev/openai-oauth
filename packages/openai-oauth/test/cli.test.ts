import { describe, expect, test, vi } from "vitest"
import {
	parseCliArgs,
	parseConfirmationAnswer,
	toLoginOptions,
	toMissingAuthFileMessage,
	toMissingAuthFilePrompt,
	toOverwriteAuthFilePrompt,
	toServerOptions,
} from "../src/cli-app.js"
import { toStartupMessage } from "../src/cli-logging.js"

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
		expect(toLoginOptions(parsed)).toMatchObject({
			host: "127.0.0.1",
			port: 0,
			authFilePath: "/tmp/auth.json",
			openBrowser: false,
			timeoutMs: 1000,
		})
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
		vi.stubEnv("HOST", "0.0.0.0")
		vi.stubEnv("PORT", "3333")

		expect(toServerOptions({})).toMatchObject({
			host: undefined,
			port: 10531,
			codexVersion: undefined,
		})

		vi.unstubAllEnvs()
	})
})
