import {
	generateText,
	streamText,
	Experimental_Agent as ToolLoopAgent,
	tool,
} from "ai"
import { describe, expect, test } from "vitest"
import * as z from "zod"
import { openai } from "../src/index.js"

const liveTest = process.env.LIVE_CODEX_E2E === "1" ? test : test.skip

describe("openai oauth provider live e2e", () => {
	liveTest(
		"supports text generation, reasoning chunks, tool calls, and agent loops",
		async () => {
			const smoke = await generateText({
				model: openai("gpt-5.2"),
				prompt: "Reply with exactly: provider-smoke-ok",
				maxOutputTokens: 20,
			})

			expect(smoke.text.trim()).toBe("provider-smoke-ok")

			const reasoningEvents: string[] = []
			let streamedText = ""
			const reasoningStream = streamText({
				model: openai("gpt-5.2"),
				prompt: "Think briefly and reply with exactly: provider-stream-ok",
				providerOptions: {
					openai: {
						reasoningEffort: "medium",
						reasoningSummary: "auto",
					},
				},
			})

			for await (const part of reasoningStream.fullStream) {
				if (part.type === "reasoning-start" || part.type === "reasoning-end") {
					reasoningEvents.push(part.type)
				}

				if (part.type === "text-delta") {
					streamedText += part.text
				}
			}

			expect(reasoningEvents).toContain("reasoning-start")
			expect(reasoningEvents).toContain("reasoning-end")
			expect(streamedText).toContain("provider-stream-ok")

			const weather = tool({
				description: "Get weather",
				inputSchema: z.object({
					city: z.string(),
				}),
			})

			const toolEvents: string[] = []
			const toolStream = streamText({
				model: openai("gpt-5.2"),
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
					toolEvents.push(part.type)
				}
			}

			expect(toolEvents).toContain("tool-input-start")
			expect(toolEvents).toContain("tool-call")

			const agent = new ToolLoopAgent({
				model: openai("gpt-5.2"),
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
			expect(
				agentResult.steps.some((step) => step.finishReason === "tool-calls"),
			).toBe(true)
		},
		120_000,
	)
})
