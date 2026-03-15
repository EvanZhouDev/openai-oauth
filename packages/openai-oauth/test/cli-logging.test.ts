import { afterEach, describe, expect, test, vi } from "vitest"
import {
	dim,
	installCliWarningLogger,
	toStartupMessage,
	underline,
} from "../src/cli-logging.js"

describe("cli logging", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	test("formats the startup banner with spacing", () => {
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

	test("applies ANSI styling when color is enabled", () => {
		expect(underline("url", { useColor: true })).toBe("\u001B[4murl\u001B[0m")
		expect(dim("text", { useColor: true })).toBe("\u001B[2mtext\u001B[0m")
	})

	test("relabels AI SDK warnings for the CLI", () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => {})
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

		installCliWarningLogger()
		globalThis.AI_SDK_LOG_WARNINGS?.({
			warnings: [
				{
					type: "unsupported",
					feature: "temperature",
					details: "temperature is not supported for reasoning models",
				},
			],
			provider: "openai.responses",
			model: "gpt-5.3-codex",
		})

		expect(info).toHaveBeenNthCalledWith(1, "")
		expect(info).toHaveBeenNthCalledWith(
			2,
			"openai-oauth Warning System: To turn off warning logging, set the AI_SDK_LOG_WARNINGS global to false.",
		)
		expect(warn).toHaveBeenCalledWith(
			'openai-oauth Warning (openai.responses / gpt-5.3-codex): The feature "temperature" is not supported. temperature is not supported for reasoning models',
		)
	})
})
