import { Buffer } from "node:buffer"
import { describe, expect, test, vi } from "vitest"

vi.mock("ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ai")>()
	return {
		...actual,
		generateText: vi.fn(),
	}
})

import { generateText } from "ai"
import type { OpenAIOAuthProvider } from "../../openai-oauth-provider/src/index.js"
import { handleChatCompletionsRequest } from "../src/chat-completions.js"

const mockedGenerateText = vi.mocked(generateText)
const dummyProvider = (() => ({})) as unknown as OpenAIOAuthProvider

describe("handleChatCompletionsRequest", () => {
	test("forwards base64 image_url parts as in-memory image bytes", async () => {
		mockedGenerateText.mockResolvedValue({
			text: "ok",
			toolCalls: [],
			finishReason: "stop",
			usage: {},
		} as unknown as Awaited<ReturnType<typeof generateText>>)

		const imageBytes = "screenshot-bytes"
		const response = await handleChatCompletionsRequest(
			new Request("http://localhost/v1/chat/completions", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: "gpt-5.4",
					messages: [
						{
							role: "user",
							content: [
								{ type: "text", text: "review this screenshot" },
								{
									type: "image_url",
									image_url: {
										url: `data:image/png;base64,${Buffer.from(imageBytes).toString("base64")}`,
									},
								},
							],
						},
					],
				}),
			}),
			dummyProvider,
			undefined,
		)

		expect(response.status).toBe(200)
		expect(mockedGenerateText).toHaveBeenCalledTimes(1)
		const [{ messages }] = mockedGenerateText.mock.calls[0] ?? []
		const imagePart = Array.isArray(messages?.[0]?.content)
			? messages[0].content[1]
			: undefined

		expect(imagePart).toMatchObject({
			type: "image",
			mediaType: "image/png",
		})
		expect(imagePart?.type === "image" && imagePart.image).toBeInstanceOf(
			Uint8Array,
		)
		expect(
			Buffer.from(
				imagePart?.type === "image" && imagePart.image instanceof Uint8Array
					? imagePart.image
					: [],
			).toString("utf-8"),
		).toBe(imageBytes)
	})
})
