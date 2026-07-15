import { describe, expect, test, vi } from "vitest"
import { resolveOpenAIOAuthModels } from "../src/models.js"

const client = (response: Response) => ({
	baseURL: "https://chatgpt.com/backend-api/codex",
	fetch: globalThis.fetch,
	request: vi.fn(async () => response),
})

describe("model discovery", () => {
	test("reads the OpenAI-compatible model list from core", async () => {
		const codex = client(
			Response.json({
				object: "list",
				data: [
					{ id: "gpt-5.6-sol", object: "model" },
					{ id: "gpt-5.6-terra", object: "model" },
				],
			}),
		)

		await expect(resolveOpenAIOAuthModels(codex, undefined)).resolves.toEqual([
			"gpt-5.6-sol",
			"gpt-5.6-terra",
		])
		expect(codex.request).toHaveBeenCalledWith("/models")
	})

	test("returns configured models without upstream discovery", async () => {
		const codex = client(Response.json({ data: [] }))

		await expect(
			resolveOpenAIOAuthModels(codex, ["gpt-5.4", "gpt-5.3-codex", "gpt-5.4"]),
		).resolves.toEqual(["gpt-5.4", "gpt-5.3-codex"])
		expect(codex.request).not.toHaveBeenCalled()
	})
})
