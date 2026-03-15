import { describe, expect, test, vi } from "vitest"
import {
	parseCliArgs,
	toMissingAuthFileMessage,
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
			"Run `npx @openai/codex login` and try again.",
		)
		expect(toMissingAuthFileMessage("/tmp/missing-auth.json")).toContain(
			"/tmp/missing-auth.json",
		)
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
