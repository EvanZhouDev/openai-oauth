import { generateText } from "ai"
import { describe, expect, test, vi } from "vitest"
import { createOpenAIOAuth } from "../src/index.js"

describe("createOpenAIOAuth", () => {
	test("uses the relay JSON responses path for browser generateText calls", async () => {
		const fetch = vi.fn(async () =>
			Response.json({
				id: "resp_1",
				created_at: 1_735_689_600,
				model: "gpt-5.4-mini",
				output: [
					{
						type: "message",
						role: "assistant",
						id: "msg_1",
						content: [
							{
								type: "output_text",
								text: "hello",
								annotations: [],
							},
						],
					},
				],
				usage: {
					input_tokens: 1,
					output_tokens: 1,
				},
			}),
		)
		const openai = createOpenAIOAuth({
			kind: "openai-oauth",
			relay: "/api/openai-oauth",
			fetch,
			getSession: async () => ({
				accessToken: "access-token",
				accountId: "acct-1",
			}),
			refreshSession: async () => ({
				accessToken: "access-token",
				accountId: "acct-1",
			}),
		})

		const result = await generateText({
			model: openai("gpt-5.4-mini"),
			prompt: "hi",
		})

		expect(result.text).toBe("hello")
		expect(fetch).toHaveBeenCalledTimes(1)

		const [url, init] = fetch.mock.calls[0] ?? []
		const headers = new Headers(init?.headers)
		const body = JSON.parse(String(init?.body))

		expect(url).toBe("/api/openai-oauth/responses")
		expect(headers.get("authorization")).toBe("Bearer access-token")
		expect(headers.get("chatgpt-account-id")).toBe("acct-1")
		expect(body.stream).toBeUndefined()
	})
})
