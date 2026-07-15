import { createOpenAI } from "@ai-sdk/openai"
import {
	generateImage,
	generateText,
	streamText,
	Experimental_Agent as ToolLoopAgent,
	tool,
} from "ai"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import * as z from "zod"
import { startOpenAIOAuthServer } from "../src/index.js"

const liveTest = process.env.LIVE_CODEX_E2E === "1" ? test : test.skip
const liveModel = "gpt-5.6-terra"

describe("openai oauth server live e2e", () => {
	let stop: (() => Promise<void>) | undefined
	let baseURL = ""

	beforeAll(async () => {
		const running = await startOpenAIOAuthServer({
			host: "127.0.0.1",
			port: 0,
		})
		stop = running.close
		baseURL = running.url
	})

	afterAll(async () => {
		await stop?.()
	})

	liveTest(
		"supports text, tools, and images through the local server",
		async () => {
			const modelsResponse = await fetch(`${baseURL}/models`)
			expect(modelsResponse.ok).toBe(true)
			const modelsPayload = await modelsResponse.json()
			expect(Array.isArray(modelsPayload.data)).toBe(true)
			expect(modelsPayload.data.length).toBeGreaterThan(0)
			expect(
				modelsPayload.data.some(
					(model: { id?: unknown }) => model.id === liveModel,
				),
			).toBe(true)
			expect(
				modelsPayload.data.some(
					(model: { id?: unknown }) => model.id === "codex-auto-review",
				),
			).toBe(false)
			expect(
				modelsPayload.data.every(
					(model: { id?: unknown }) =>
						typeof model.id === "string" && model.id.length > 0,
				),
			).toBe(true)

			const directResponse = await fetch(`${baseURL}/responses`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: liveModel,
					stream: false,
					input: "Reply with exactly: endpoint-json-ok",
				}),
			})

			expect(directResponse.ok).toBe(true)
			const directPayload = await directResponse.json()
			expect(directPayload.status).toBe("completed")
			expect(directPayload.usage.input_tokens).toBeGreaterThan(0)
			expect(directPayload.usage.output_tokens).toBeGreaterThan(0)

			const openai = createOpenAI({
				baseURL,
				apiKey: "unused",
			})

			const smoke = await generateText({
				model: openai.responses(liveModel),
				prompt: "Reply with exactly: server-smoke-ok",
			})
			expect(smoke.text.trim()).toBe("server-smoke-ok")
			expect(smoke.finishReason).toBe("stop")
			expect(smoke.usage.inputTokens).toBeGreaterThan(0)
			expect(smoke.usage.outputTokens).toBeGreaterThan(0)

			const chatSmoke = await generateText({
				model: openai.chat(liveModel),
				prompt: "Reply with exactly: server-chat-ok",
			})
			expect(chatSmoke.text.trim()).toBe("server-chat-ok")
			expect(chatSmoke.finishReason).toBe("stop")
			expect(chatSmoke.usage.inputTokens).toBeGreaterThan(0)
			expect(chatSmoke.usage.outputTokens).toBeGreaterThan(0)

			const generatedImage = await generateImage({
				model: openai.image("gpt-image-2"),
				prompt: "A simple blue square centered on a plain white background.",
				size: "1024x1024",
				providerOptions: {
					openai: {
						background: "opaque",
						quality: "low",
					},
				},
			})
			expect(generatedImage.image.base64.length).toBeGreaterThan(100)
			expect(generatedImage.usage.outputTokens).toBeGreaterThan(0)

			const editedImage = await generateImage({
				model: openai.image("gpt-image-2"),
				prompt: {
					text: "Change the square from blue to green.",
					images: [generatedImage.image.uint8Array],
				},
				size: "1024x1024",
				providerOptions: {
					openai: {
						background: "opaque",
						quality: "low",
					},
				},
			})
			expect(editedImage.image.base64.length).toBeGreaterThan(100)
			expect(editedImage.usage.inputTokens).toBeGreaterThan(0)

			const weather = tool({
				description: "Get weather",
				inputSchema: z.object({
					city: z.string(),
				}),
			})

			const streamedToolEvents: string[] = []
			let streamFinishReason: string | undefined
			let streamInputTokens: number | undefined
			const toolStream = streamText({
				model: openai.chat(liveModel),
				messages: [
					{
						role: "user",
						content: "Use the weather tool for San Francisco.",
					},
				],
				tools: { weather },
			})

			for await (const part of toolStream.fullStream) {
				if (
					part.type === "tool-input-start" ||
					part.type === "tool-input-delta" ||
					part.type === "tool-call"
				) {
					streamedToolEvents.push(part.type)
				}

				if (part.type === "finish") {
					streamFinishReason = part.finishReason
					streamInputTokens = part.totalUsage.inputTokens
				}
			}

			expect(streamedToolEvents).toContain("tool-input-start")
			expect(streamedToolEvents).toContain("tool-call")
			expect(streamFinishReason).toBe("tool-calls")
			expect(streamInputTokens).toBeGreaterThan(0)

			const agent = new ToolLoopAgent({
				model: openai.chat(liveModel),
				tools: {
					weather: tool({
						description: "Get weather",
						inputSchema: z.object({
							city: z.string(),
						}),
						execute: async ({ city }) => ({
							city,
							tempC: 21,
						}),
					}),
				},
			})

			const agentResult = await agent.generate({
				prompt:
					"Use the weather tool for San Francisco and answer with the temperature only.",
			})

			expect(agentResult.text).toContain("21")
		},
		120_000,
	)
})
