import { afterEach, describe, expect, test, vi } from "vitest"
import { createOpenAIOAuthTransport } from "../src/index.js"
import {
	createOpenAIOAuthTransport as createRuntimeOpenAIOAuthTransport,
	normalizeCodexResponsesBody,
	type OpenAIOAuthTransportOptions,
} from "../src/runtime.js"
import { collectCompletedResponseFromSse } from "../src/sse.js"

const createCodexOAuthFetch = (options: OpenAIOAuthTransportOptions) =>
	createRuntimeOpenAIOAuthTransport(options).fetch

const session = {
	accessToken: "access-token",
	accountId: "acct-1",
}

const createMockFetch = (
	handleUpstream: (
		input: RequestInfo | URL,
		init?: RequestInit,
	) => Promise<Response> = async () => new Response(null, { status: 200 }),
) =>
	vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input)
		if (url === "https://registry.npmjs.org/@openai/codex/latest") {
			return new Response(JSON.stringify({ version: "0.144.1" }))
		}
		if (url.includes("/backend-api/codex/models?")) {
			return new Response(
				JSON.stringify({
					models: [
						{ slug: "gpt-5.2", visibility: "list" },
						{ slug: "gpt-5.4-mini", visibility: "list" },
						{ slug: "codex-auto-review", visibility: "hide" },
						{
							slug: "gpt-5.6-sol",
							visibility: "list",
							use_responses_lite: true,
							support_verbosity: true,
							default_verbosity: "low",
							default_reasoning_level: "low",
						},
					],
				}),
			)
		}
		return handleUpstream(input, init)
	})

const upstreamCalls = (fetch: ReturnType<typeof createMockFetch>) =>
	fetch.mock.calls.filter(
		([input]) =>
			!String(input).includes("registry.npmjs.org") &&
			!String(input).includes("/backend-api/codex/models?"),
	)

afterEach(() => {
	vi.restoreAllMocks()
})

describe("normalizeCodexResponsesBody", () => {
	test("adds an empty-string fallback, disables store, and strips max_output_tokens", () => {
		const normalized = normalizeCodexResponsesBody({
			model: "gpt-5.2",
			max_output_tokens: 128,
		})

		expect(normalized.instructions).toBe("")
		expect(normalized.store).toBe(false)
		expect("max_output_tokens" in normalized).toBe(false)
	})

	test("preserves caller-provided instructions and always disables storage", () => {
		const normalized = normalizeCodexResponsesBody(
			{
				instructions: "caller-instructions",
				store: true,
			},
			{
				instructions: "default-instructions",
			},
		)

		expect(normalized.instructions).toBe("caller-instructions")
		expect(normalized.store).toBe(false)
	})

	test("preserves explicit empty and whitespace instructions", () => {
		expect(
			normalizeCodexResponsesBody(
				{
					instructions: "",
				},
				{
					instructions: "default-instructions",
				},
			).instructions,
		).toBe("")

		expect(
			normalizeCodexResponsesBody(
				{
					instructions: " ",
				},
				{
					instructions: "default-instructions",
				},
			).instructions,
		).toBe(" ")
	})

	test("normalizes string input and requests encrypted reasoning content", () => {
		const normalized = normalizeCodexResponsesBody({
			model: "gpt-5.2",
			input: "Hello",
			include: ["web_search_call.action.sources"],
		})

		expect(normalized.input).toEqual([
			{
				role: "user",
				content: [{ type: "input_text", text: "Hello" }],
			},
		])
		expect(normalized.include).toEqual([
			"web_search_call.action.sources",
			"reasoning.encrypted_content",
		])
	})
})

describe("createCodexOAuthFetch", () => {
	test("returns an OpenAI-compatible list of visible models", async () => {
		const fetch = createMockFetch()
		const connection = createOpenAIOAuthTransport({ auth: session, fetch })

		const response = await connection.request("/models")
		const payload = await response.json()

		expect(response.status).toBe(200)
		expect(payload.data.map((model: { id: string }) => model.id)).toEqual([
			"gpt-5.2",
			"gpt-5.4-mini",
			"gpt-5.6-sol",
			"gpt-image-2",
		])
		expect(upstreamCalls(fetch)).toHaveLength(0)
	})

	test("creates an in-memory OpenAI-compatible connection", async () => {
		const fetch = createMockFetch()
		const connection = createOpenAIOAuthTransport({
			auth: session,
			fetch,
		})

		expect(connection.kind).toBe("openai-compatible")
		expect(connection.baseURL).toBe("https://openai-oauth.local/v1")

		await connection.request("/responses", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: "gpt-5.2" }),
		})

		expect(upstreamCalls(fetch)).toContainEqual([
			"https://chatgpt.com/backend-api/codex/responses",
			expect.objectContaining({
				method: "POST",
			}),
		])
	})

	test("injects oauth headers and normalizes responses requests", async () => {
		const fetch = createMockFetch()

		const oauthFetch = createCodexOAuthFetch({
			auth: session,
			fetch,
			instructions: "core-instructions",
		})

		await oauthFetch("https://example.test/v1/responses", {
			method: "POST",
			headers: {
				Authorization: "Bearer ignored",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "gpt-5.2",
				max_output_tokens: 5,
			}),
		})

		expect(upstreamCalls(fetch)).toHaveLength(1)
		const [, init] = upstreamCalls(fetch)[0] ?? []
		const headers = new Headers(init?.headers)
		const body = JSON.parse(String(init?.body))

		expect(headers.get("authorization")).toMatch(/^Bearer /)
		expect(headers.get("chatgpt-account-id")).toBeTruthy()
		expect(headers.has("openai-beta")).toBe(false)
		expect(body.instructions).toBe("core-instructions")
		expect(body.store).toBe(false)
		expect(body.stream).toBe(true)
		expect(body.max_output_tokens).toBeUndefined()
	})

	test("bridges non-streaming OpenAI requests over the required SSE transport", async () => {
		const fetch = createMockFetch(
			async () =>
				new Response(
					[
						"event: response.completed",
						'data: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-5.6-sol","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1}}}',
						"",
						"",
					].join("\n"),
					{ headers: { "Content-Type": "text/event-stream" } },
				),
		)
		const oauthFetch = createCodexOAuthFetch({ auth: session, fetch })

		const response = await oauthFetch("https://example.test/v1/responses", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "gpt-5.6-sol",
				instructions: "Be concise.",
				input: "Hello",
				tools: [{ type: "function", name: "weather" }],
				parallel_tool_calls: true,
			}),
		})

		expect(response.headers.get("content-type")).toBe("application/json")
		await expect(response.json()).resolves.toMatchObject({
			id: "resp_1",
			status: "completed",
			usage: { input_tokens: 1, output_tokens: 1 },
		})
		const [, init] = upstreamCalls(fetch)[0] ?? []
		const headers = new Headers(init?.headers)
		const body = JSON.parse(String(init?.body))
		expect(headers.get("x-openai-internal-codex-responses-lite")).toBe("true")
		expect(body.stream).toBe(true)
		expect(body).toMatchObject({
			instructions: "",
			parallel_tool_calls: false,
			reasoning: { effort: "low", context: "all_turns" },
			text: { verbosity: "low" },
		})
		expect(body.tools).toBeUndefined()
		expect(body.input).toEqual([
			{
				type: "additional_tools",
				role: "developer",
				tools: [{ type: "function", name: "weather" }],
			},
			{
				role: "developer",
				content: [{ type: "input_text", text: "Be concise." }],
			},
			{
				role: "user",
				content: [{ type: "input_text", text: "Hello" }],
			},
		])
	})

	test("routes FedRAMP sessions without accepting caller header overrides", async () => {
		const fetch = createMockFetch()
		const oauthFetch = createCodexOAuthFetch({
			auth: { ...session, isFedRamp: true },
			fetch,
		})

		await oauthFetch("responses", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-OpenAI-Fedramp": "false",
			},
			body: JSON.stringify({ model: "gpt-5.2", input: [] }),
		})

		const [, init] = upstreamCalls(fetch)[0] ?? []
		expect(new Headers(init?.headers).get("x-openai-fedramp")).toBe("true")
	})

	test("preserves absolute codex urls without duplicating the upstream path", async () => {
		const fetch = createMockFetch()

		const oauthFetch = createCodexOAuthFetch({
			auth: session,
			fetch,
		})

		await oauthFetch(
			"https://chatgpt.com/backend-api/codex/responses?foo=bar",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "gpt-5.2",
				}),
			},
		)

		expect(upstreamCalls(fetch)).toEqual([
			[
				"https://chatgpt.com/backend-api/codex/responses?foo=bar",
				expect.any(Object),
			],
		])
	})

	test("supports relative response paths", async () => {
		const fetch = createMockFetch()

		const oauthFetch = createCodexOAuthFetch({
			auth: session,
			fetch,
		})

		await oauthFetch("responses", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "gpt-5.2",
			}),
		})

		expect(upstreamCalls(fetch)).toEqual([
			["https://chatgpt.com/backend-api/codex/responses", expect.any(Object)],
		])
	})

	test("can disable local replay state entirely", async () => {
		const fetch = createMockFetch()

		const oauthFetch = createCodexOAuthFetch({
			auth: session,
			fetch,
			responsesState: false,
		})

		await oauthFetch("https://example.test/v1/responses", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "gpt-5.2",
				previous_response_id: "resp_1",
				input: [],
			}),
		})

		const [, init] = upstreamCalls(fetch)[0] ?? []
		expect(JSON.parse(String(init?.body))).toMatchObject({
			model: "gpt-5.2",
			previous_response_id: "resp_1",
			input: [],
			store: false,
			instructions: "",
		})
	})

	test("runtime connection replays prior response state locally", async () => {
		const fetch = createMockFetch(async () => {
			return new Response(
				[
					"event: response.completed",
					'data: {"response":{"id":"resp_1","status":"completed","output":[{"type":"function_call","id":"fc_1","call_id":"call_1","name":"weather","arguments":"{}"}]}}',
					"",
					"",
				].join("\n"),
				{
					headers: { "Content-Type": "text/event-stream" },
				},
			)
		})
		const connection = createRuntimeOpenAIOAuthTransport({
			auth: {
				accessToken: "access-token",
				accountId: "acct-1",
			},
			fetch,
		})

		const firstResponse = await connection.request("/responses", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "gpt-5.4-mini",
				input: [{ role: "user", content: "Use the weather tool." }],
				stream: true,
			}),
		})
		await firstResponse.text()

		await connection.request("/responses", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "gpt-5.4-mini",
				previous_response_id: "resp_1",
				input: [{ type: "item_reference", id: "fc_1" }],
				stream: true,
			}),
		})

		const [, secondInit] = upstreamCalls(fetch)[1] ?? []
		const secondBody = JSON.parse(String(secondInit?.body))
		expect(secondBody.previous_response_id).toBeUndefined()
		expect(secondBody.input).toEqual([
			{ role: "user", content: "Use the weather tool." },
			{
				type: "function_call",
				id: "fc_1",
				call_id: "call_1",
				name: "weather",
				arguments: "{}",
			},
			{
				type: "function_call",
				id: "fc_1",
				call_id: "call_1",
				name: "weather",
				arguments: "{}",
			},
		])
	})

	test("accepts an async session supplier", async () => {
		const fetch = createMockFetch()
		const getSession = vi.fn(async () => session)
		const oauthFetch = createCodexOAuthFetch({
			auth: getSession,
			fetch,
		})

		await oauthFetch("responses", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "gpt-5.2",
			}),
		})

		expect(getSession).toHaveBeenCalledTimes(1)
		expect(upstreamCalls(fetch)).toEqual([
			["https://chatgpt.com/backend-api/codex/responses", expect.any(Object)],
		])
	})

	test("normalizes image generation requests for the Codex Images API", async () => {
		const fetch = createMockFetch(async () =>
			Response.json({ created: 1, data: [{ b64_json: "image-data" }] }),
		)
		const oauthFetch = createCodexOAuthFetch({ auth: session, fetch })

		const response = await oauthFetch(
			"https://example.test/v1/images/generations",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					prompt: "draw a square",
					quality: "low",
					size: "1024x1024",
					response_format: "b64_json",
				}),
			},
		)

		expect(response.status).toBe(200)
		const [[url, init]] = upstreamCalls(fetch)
		expect(url).toBe("https://chatgpt.com/backend-api/codex/images/generations")
		expect(new Headers(init?.headers).get("content-type")).toBe(
			"application/json",
		)
		expect(JSON.parse(String(init?.body))).toEqual({
			model: "gpt-image-2",
			prompt: "draw a square",
			quality: "low",
			size: "1024x1024",
		})
	})

	test("converts multipart image edits into Codex reference images", async () => {
		const fetch = createMockFetch(async () =>
			Response.json({ created: 1, data: [{ b64_json: "edited-image" }] }),
		)
		const oauthFetch = createCodexOAuthFetch({ auth: session, fetch })
		const body = new FormData()
		body.set("model", "gpt-image-2")
		body.set("prompt", "add a red hat")
		body.append(
			"image[]",
			new Blob([new Uint8Array([1, 2, 3])], {
				type: "image/png",
			}),
			"input.png",
		)
		body.set("n", "1")
		body.set("background", "opaque")

		const response = await oauthFetch("https://example.test/v1/images/edits", {
			method: "POST",
			body,
		})

		expect(response.status).toBe(200)
		const [[url, init]] = upstreamCalls(fetch)
		expect(url).toBe("https://chatgpt.com/backend-api/codex/images/edits")
		expect(new Headers(init?.headers).get("content-type")).toBe(
			"application/json",
		)
		expect(JSON.parse(String(init?.body))).toEqual({
			images: [{ image_url: "data:image/png;base64,AQID" }],
			model: "gpt-image-2",
			prompt: "add a red hat",
			n: 1,
			background: "opaque",
		})
	})

	test("rejects unsupported streaming image requests before fetching", async () => {
		const fetch = createMockFetch()
		const oauthFetch = createCodexOAuthFetch({ auth: session, fetch })

		const response = await oauthFetch(
			"https://example.test/v1/images/generations",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ prompt: "draw a square", stream: true }),
			},
		)

		expect(response.status).toBe(400)
		expect(upstreamCalls(fetch)).toHaveLength(0)
	})
})

describe("collectCompletedResponseFromSse", () => {
	test("returns the completed response object", async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						[
							"event: response.created",
							'data: {"response":{"id":"resp_1","status":"in_progress"}}',
							"",
							"event: response.completed",
							'data: {"response":{"id":"resp_1","status":"completed","output":[{"type":"message"}]}}',
							"",
						].join("\n"),
					),
				)
				controller.close()
			},
		})

		await expect(collectCompletedResponseFromSse(stream)).resolves.toEqual({
			id: "resp_1",
			status: "completed",
			output: [{ type: "message" }],
		})
	})

	test("returns after response.completed even when the stream stays open", async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						[
							"event: response.completed",
							'data: {"response":{"id":"resp_1","status":"completed","output":[{"type":"message"}]}}',
							"",
							"",
						].join("\n"),
					),
				)
			},
		})

		await expect(collectCompletedResponseFromSse(stream)).resolves.toEqual({
			id: "resp_1",
			status: "completed",
			output: [{ type: "message" }],
		})
	})

	test("fills completed response output from streamed output item events", async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						[
							"event: response.output_item.done",
							'data: {"type":"response.output_item.done","item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"weather","arguments":"{}"}}',
							"",
							"event: response.completed",
							'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","output":[]}}',
							"",
							"",
						].join("\n"),
					),
				)
			},
		})

		await expect(collectCompletedResponseFromSse(stream)).resolves.toEqual({
			id: "resp_1",
			status: "completed",
			output: [
				{
					type: "function_call",
					id: "fc_1",
					call_id: "call_1",
					name: "weather",
					arguments: "{}",
				},
			],
		})
	})
})
