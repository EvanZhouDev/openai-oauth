import { generateImage, generateText } from "ai"
import { describe, expect, test, vi } from "vitest"
import { createOpenAIOAuth } from "../src/index.js"

describe("createOpenAIOAuth", () => {
	test("uses request-bound OAuth credentials for generateText calls", async () => {
		const fetch = vi.fn(async (input: RequestInfo | URL) => {
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
					],
				})
			}
			if (url === "https://chatgpt.com/backend-api/codex/responses") {
				return new Response(
					[
						"event: response.created",
						'data: {"type":"response.created","response":{"id":"resp_1","model":"gpt-5.6-sol","created_at":1735689600}}',
						"",
						"event: response.output_text.delta",
						'data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"hello"}',
						"",
						"event: response.output_text.done",
						'data: {"type":"response.output_text.done","item_id":"msg_1","output_index":0,"content_index":0,"text":"hello"}',
						"",
						"event: response.completed",
						'data: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-5.6-sol","created_at":1735689600,"status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1}}}',
						"",
						"",
					].join("\n"),
					{
						headers: { "Content-Type": "text/event-stream" },
					},
				)
			}

			throw new Error(`Unexpected request: ${url}`)
		})
		const openai = createOpenAIOAuth({
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
		})

		const result = await generateText({
			model: openai("gpt-5.6-sol"),
			prompt: "hi",
		})

		expect(result.text).toBe("hello")
		expect(result.finishReason).toBe("stop")
		expect(result.usage.inputTokens).toBe(1)
		expect(result.usage.outputTokens).toBe(1)
		expect(result.usage.totalTokens).toBe(2)
		const responseCall = fetch.mock.calls.find(
			([input]) =>
				String(input) === "https://chatgpt.com/backend-api/codex/responses",
		)
		const [url, init] = responseCall ?? []
		const headers = new Headers(init?.headers)
		const body = JSON.parse(String(init?.body))

		expect(url).toBe("https://chatgpt.com/backend-api/codex/responses")
		expect(headers.get("authorization")).toBe("Bearer access-token")
		expect(headers.get("chatgpt-account-id")).toBe("acct-1")
		expect(headers.get("x-openai-internal-codex-responses-lite")).toBe("true")
		expect(body.stream).toBe(true)
		expect(body.store).toBe(false)
		expect(body.reasoning).toMatchObject({
			effort: "low",
			context: "all_turns",
		})
		expect(body.text).toMatchObject({ verbosity: "low" })
	})

	test("uses ChatGPT OAuth for image generation and editing", async () => {
		const requests: Array<{ path: string; body: Record<string, unknown> }> = []
		const fetch = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = new URL(String(input))
				if (
					url.pathname.endsWith("/images/generations") ||
					url.pathname.endsWith("/images/edits")
				) {
					requests.push({
						path: url.pathname,
						body: JSON.parse(String(init?.body)),
					})
					return Response.json({
						created: 1,
						data: [{ b64_json: "AQID" }],
						usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
					})
				}
				throw new Error(`Unexpected request: ${url}`)
			},
		)
		const openai = createOpenAIOAuth({
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
		})

		const generated = await generateImage({
			model: openai.image("gpt-image-2"),
			prompt: "draw a square",
			size: "1024x1024",
		})
		const edited = await generateImage({
			model: openai.image("gpt-image-2"),
			prompt: {
				text: "add a red hat",
				images: [new Uint8Array([1, 2, 3])],
			},
		})

		expect(generated.image.base64).toBe("AQID")
		expect(edited.image.base64).toBe("AQID")
		expect(generated.usage).toEqual({
			inputTokens: 2,
			outputTokens: 3,
			totalTokens: 5,
		})
		expect(requests).toEqual([
			{
				path: "/backend-api/codex/images/generations",
				body: {
					model: "gpt-image-2",
					prompt: "draw a square",
					n: 1,
					size: "1024x1024",
				},
			},
			{
				path: "/backend-api/codex/images/edits",
				body: {
					images: [{ image_url: "data:image/png;base64,AQID" }],
					model: "gpt-image-2",
					prompt: "add a red hat",
					n: 1,
				},
			},
		])
	})
})
