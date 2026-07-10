import { describe, expect, test, vi } from "vitest"
import {
	fetchCodexModelCatalog,
	resetCodexClientVersionCache,
	resolveCodexClientVersion,
} from "../src/models.js"

describe("Codex model catalog", () => {
	test("uses the latest Codex package version from npm", async () => {
		resetCodexClientVersionCache()
		const fetchImpl = vi.fn(async () => Response.json({ version: "0.144.1" }))

		await expect(resolveCodexClientVersion({ fetchImpl })).resolves.toBe(
			"0.144.1",
		)
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://registry.npmjs.org/@openai/codex/latest",
			expect.any(Object),
		)
	})

	test("uses an explicit Codex version without a registry request", async () => {
		resetCodexClientVersionCache()
		const fetchImpl = vi.fn(async () => {
			throw new Error("registry lookup should not run")
		})

		await expect(
			resolveCodexClientVersion({ codexVersion: "0.200.0", fetchImpl }),
		).resolves.toBe("0.200.0")
		expect(fetchImpl).not.toHaveBeenCalled()
	})

	test("uses the verified fallback when npm is unavailable", async () => {
		resetCodexClientVersionCache()
		const warnings: string[] = []

		const version = await resolveCodexClientVersion({
			fetchImpl: async () => {
				throw new Error("network unavailable")
			},
			onWarning: (message) => warnings.push(message),
		})

		expect(version).toBe("0.144.1")
		expect(warnings).toEqual([
			"Could not determine the latest Codex version. Falling back to 0.144.1. Pass a version explicitly if you need to override it.",
		])
	})

	test("parses model metadata using the resolved client version", async () => {
		resetCodexClientVersionCache()
		const request = vi.fn(async () =>
			Response.json({
				models: [
					{
						slug: "gpt-5.6-sol",
						visibility: "list",
						supported_in_api: true,
						use_responses_lite: true,
					},
				],
			}),
		)

		await expect(
			fetchCodexModelCatalog({ request }, { codexVersion: "0.144.1" }),
		).resolves.toMatchObject([
			{
				slug: "gpt-5.6-sol",
				visibility: "list",
				supportedInApi: true,
				useResponsesLite: true,
			},
		])
		expect(request).toHaveBeenCalledWith("/models?client_version=0.144.1")
	})
})
