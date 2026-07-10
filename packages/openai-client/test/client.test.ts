import OpenAI from "openai"
import { describe, expect, test, vi } from "vitest"
import { createOpenAIOptions } from "../src/index.js"

const completedResponseStream = () =>
	new Response(
		[
			"event: response.output_item.done",
			'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_1","status":"completed","role":"assistant","content":[{"type":"output_text","annotations":[],"text":"hello"}]}}',
			"",
			"event: response.completed",
			'data: {"type":"response.completed","response":{"id":"resp_1","created_at":1735689600,"model":"gpt-5.6-sol","status":"completed","output":[],"usage":{"input_tokens":2,"input_tokens_details":{"cached_tokens":0},"output_tokens":1,"output_tokens_details":{"reasoning_tokens":0}}}}',
			"",
			"",
		].join("\n"),
		{ headers: { "Content-Type": "text/event-stream" } },
	)

describe("createOpenAIOptions", () => {
	test("drives the OpenAI SDK through the in-memory Codex transport", async () => {
		let responsesRequest:
			| { headers: Headers; body: Record<string, unknown> }
			| undefined
		const fetch = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input)
				if (url === "https://registry.npmjs.org/@openai/codex/latest") {
					return Response.json({ version: "0.144.1" })
				}
				if (url.includes("/backend-api/codex/models?")) {
					return Response.json({
						models: [
							{
								slug: "gpt-5.6-sol",
								visibility: "list",
								use_responses_lite: true,
								support_verbosity: true,
								default_verbosity: "low",
								default_reasoning_level: "low",
							},
							{ slug: "codex-auto-review", visibility: "hide" },
						],
					})
				}
				if (url === "https://chatgpt.com/backend-api/codex/responses") {
					responsesRequest = {
						headers: new Headers(init?.headers),
						body: JSON.parse(String(init?.body)),
					}
					return completedResponseStream()
				}

				throw new Error(`Unexpected request: ${url}`)
			},
		)
		const client = new OpenAI(
			createOpenAIOptions({
				kind: "openai-oauth",
				fetch,
				getSession: async () => ({
					accessToken: "access-token",
					accountId: "acct-1",
				}),
				refreshSession: async () => ({
					accessToken: "access-token",
					accountId: "acct-1",
				}),
			}),
		)

		const models = await client.models.list()
		expect(models.data.map((model) => model.id)).toEqual(["gpt-5.6-sol"])

		const response = await client.responses.create({
			model: "gpt-5.6-sol",
			input: "Say hello.",
		})

		expect(response).toMatchObject({
			id: "resp_1",
			status: "completed",
			output: [
				{
					type: "message",
					content: [{ type: "output_text", text: "hello" }],
				},
			],
			usage: { input_tokens: 2, output_tokens: 1 },
		})
		expect(responsesRequest?.headers.get("authorization")).toBe(
			"Bearer access-token",
		)
		expect(responsesRequest?.headers.get("chatgpt-account-id")).toBe("acct-1")
		expect(
			responsesRequest?.headers.get("x-openai-internal-codex-responses-lite"),
		).toBe("true")
		expect(responsesRequest?.headers.has("openai-beta")).toBe(false)
		expect(responsesRequest?.body).toMatchObject({
			model: "gpt-5.6-sol",
			stream: true,
			store: false,
			reasoning: { effort: "low", context: "all_turns" },
			text: { verbosity: "low" },
			input: [
				{
					role: "user",
					content: [{ type: "input_text", text: "Say hello." }],
				},
			],
		})
	})
})
