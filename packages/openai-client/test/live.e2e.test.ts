import { openaiCredentials } from "@openai-oauth/local"
import OpenAI from "openai"
import { describe, expect, test } from "vitest"
import { createOpenAIOptions } from "../src/index.js"

const liveTest = process.env.LIVE_CODEX_E2E === "1" ? test : test.skip
const liveModel = "gpt-5.6-terra"

describe("OpenAI client adapter live e2e", () => {
	liveTest(
		"lists GPT-5.6 and completes a non-streaming Responses request",
		async () => {
			const client = new OpenAI(createOpenAIOptions(openaiCredentials()))
			const models = await client.models.list()

			expect(models.data.some((model) => model.id === liveModel)).toBe(true)
			expect(
				models.data.some((model) => model.id === "codex-auto-review"),
			).toBe(false)

			const response = await client.responses.create({
				model: liveModel,
				input: "Reply with exactly: openai-client-live-ok",
			})
			const text = response.output
				.flatMap((item) => (item.type === "message" ? item.content : []))
				.filter((item) => item.type === "output_text")
				.map((item) => item.text)
				.join("")

			expect(response.status).toBe("completed")
			expect(text.trim()).toBe("openai-client-live-ok")
			expect(response.usage?.input_tokens).toBeGreaterThan(0)
			expect(response.usage?.output_tokens).toBeGreaterThan(0)
		},
		120_000,
	)
})
