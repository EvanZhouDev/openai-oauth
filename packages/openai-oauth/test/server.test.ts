import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import {
	createOpenAIOAuthFetchHandler,
	startOpenAIOAuthServer,
} from "../src/index.js"

const createAuthFile = async (): Promise<string> => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "openai-oauth-server-"))
	const authPath = path.join(root, "auth.json")
	await fs.writeFile(
		authPath,
		JSON.stringify(
			{
				tokens: {
					access_token: "access-token",
					account_id: "acct-1",
				},
			},
			null,
			2,
		),
		"utf-8",
	)
	return authPath
}

const createSseResponse = (events: Array<[string, Record<string, unknown>]>) =>
	new Response(
		events
			.flatMap(([event, data]) => [
				`event: ${event}`,
				`data: ${JSON.stringify(data)}`,
				"",
			])
			.join("\n"),
		{
			status: 200,
			headers: { "Content-Type": "text/event-stream" },
		},
	)

const upstreamResponseCalls = (fetch: ReturnType<typeof vi.fn>) =>
	fetch.mock.calls.filter(([input]) =>
		String(input).endsWith("/backend-api/codex/responses"),
	)

describe("openai oauth server", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	test("lists configured models", async () => {
		const handler = createOpenAIOAuthFetchHandler({
			models: ["gpt-5.2", "gpt-5.1-codex"],
		})

		const response = await handler(
			new Request("http://localhost/v1/models", {
				method: "GET",
			}),
		)

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({
			object: "list",
			data: [
				{
					id: "gpt-5.2",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.1-codex",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
			],
		})
	})

	test("loads account models from codex when no override is configured", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn(async (input: RequestInfo | URL) => {
			if (String(input) === "https://registry.npmjs.org/@openai/codex/latest") {
				return Response.json({ version: "0.144.1" })
			}
			expect(String(input)).toContain(
				"/backend-api/codex/models?client_version=",
			)
			return new Response(
				JSON.stringify({
					models: [
						{ slug: "gpt-5.2" },
						{ slug: "gpt-5.1-codex" },
						{ slug: "gpt-5.2" },
					],
				}),
				{
					status: 200,
					headers: {
						"Content-Type": "application/json",
					},
				},
			)
		})
		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			ensureFresh: false,
			fetch,
		})

		const response = await handler(
			new Request("http://localhost/v1/models", {
				method: "GET",
			}),
		)

		expect(response.status).toBe(200)
		expect(
			fetch.mock.calls.some(([input]) =>
				String(input).includes(
					"/backend-api/codex/models?client_version=0.144.1",
				),
			),
		).toBe(true)
		await expect(response.json()).resolves.toEqual({
			object: "list",
			data: [
				{
					id: "gpt-5.2",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-5.1-codex",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
				{
					id: "gpt-image-2",
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				},
			],
		})

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("returns an upstream error when codex model discovery fails", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						detail: "This account does not support codex model discovery.",
					}),
					{
						status: 403,
						headers: {
							"Content-Type": "application/json",
						},
					},
				),
		)
		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			ensureFresh: false,
			fetch,
		})

		const response = await handler(
			new Request("http://localhost/v1/models", {
				method: "GET",
			}),
		)

		expect(response.status).toBe(502)
		await expect(response.json()).resolves.toEqual({
			error: {
				message: "This account does not support codex model discovery.",
				type: "upstream_error",
			},
		})

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("reports the replay state mode in health", async () => {
		const handler = createOpenAIOAuthFetchHandler()
		const health = await handler(
			new Request("http://localhost/health", {
				method: "GET",
			}),
		)

		await expect(health.json()).resolves.toEqual({
			ok: true,
			replay_state: "stateless",
		})

		const memoryHandler = createOpenAIOAuthFetchHandler({
			responsesState: "memory",
		})
		const memoryHealth = await memoryHandler(
			new Request("http://localhost/health"),
		)

		await expect(memoryHealth.json()).resolves.toEqual({
			ok: true,
			replay_state: "memory",
		})
	})

	test("rejects an invalid programmatic replay state mode", () => {
		expect(() =>
			createOpenAIOAuthFetchHandler({
				responsesState: "persistent" as never,
			}),
		).toThrow(
			'Invalid `responsesState` option. Expected "stateless" or "memory".',
		)
	})

	test("rejects invalid memory cache bounds", () => {
		expect(() =>
			createOpenAIOAuthFetchHandler({
				responsesState: "memory",
				responsesMaxResponses: 0,
			}),
		).toThrow("maxResponses must be a positive integer.")
		expect(() =>
			createOpenAIOAuthFetchHandler({
				responsesState: "memory",
				responsesMaxItems: 1.5,
			}),
		).toThrow("maxItems must be a positive integer.")
	})

	test("starts an HTTP server in memory replay mode", async () => {
		const running = await startOpenAIOAuthServer({
			host: "127.0.0.1",
			port: 0,
			models: ["gpt-5.6-sol"],
			responsesState: "memory",
		})

		try {
			const healthUrl = new URL("/health", running.url)
			const response = await fetch(healthUrl)

			expect(response.status).toBe(200)
			await expect(response.json()).resolves.toEqual({
				ok: true,
				replay_state: "memory",
			})
		} finally {
			await running.close()
		}
	})

	test("does not opt the local proxy into browser CORS", async () => {
		const handler = createOpenAIOAuthFetchHandler()
		const response = await handler(
			new Request("http://localhost/health", {
				headers: { Origin: "https://app.example" },
			}),
		)

		expect(response.status).toBe(200)
		expect(response.headers.has("access-control-allow-origin")).toBe(false)
	})

	test("aggregates streaming responses requests into json when stream is false", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn(async (input: RequestInfo | URL) => {
			if (String(input).includes("/backend-api/codex/models?")) {
				return new Response(
					JSON.stringify({
						models: [{ slug: "gpt-5.2", visibility: "list" }],
					}),
				)
			}
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

			return new Response(stream, { status: 200 })
		})

		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			ensureFresh: false,
			fetch,
			instructions: "server-instructions",
		})

		const response = await handler(
			new Request("http://localhost/v1/responses", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "gpt-5.2",
					stream: false,
					max_output_tokens: 5,
				}),
			}),
		)

		const responseCalls = fetch.mock.calls.filter(([input]) =>
			String(input).endsWith("/backend-api/codex/responses"),
		)
		expect(responseCalls).toHaveLength(1)
		const [, init] = responseCalls[0] ?? []
		expect(JSON.parse(String(init?.body))).toMatchObject({
			model: "gpt-5.2",
			stream: true,
			instructions: "server-instructions",
		})

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({
			id: "resp_1",
			status: "completed",
			output: [{ type: "message" }],
		})

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("returns finish reason and usage for chat completions", async () => {
		const authFilePath = await createAuthFile()
		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			codexVersion: "0.144.1",
			ensureFresh: false,
			fetch: async (input) => {
				if (String(input).includes("/backend-api/codex/models?")) {
					return Response.json({
						models: [
							{
								slug: "gpt-5.4-mini",
								visibility: "list",
								use_responses_lite: true,
							},
						],
					})
				}

				return new Response(
					[
						"event: response.created",
						'data: {"type":"response.created","response":{"id":"resp_1","model":"gpt-5.4-mini","created_at":1735689600}}',
						"",
						"event: response.output_item.added",
						'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_1","phase":"final_answer"}}',
						"",
						"event: response.output_text.delta",
						'data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"hello"}',
						"",
						"event: response.output_item.done",
						'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_1","phase":"final_answer"}}',
						"",
						"event: response.completed",
						'data: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-5.4-mini","created_at":1735689600,"status":"completed","output":[],"usage":{"input_tokens":3,"input_tokens_details":{"cached_tokens":1},"output_tokens":2,"output_tokens_details":{"reasoning_tokens":0}}}}',
						"",
						"",
					].join("\n"),
					{
						headers: { "Content-Type": "text/event-stream" },
					},
				)
			},
		})

		const response = await handler(
			new Request("http://localhost/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "gpt-5.4-mini",
					messages: [{ role: "user", content: "say hello" }],
				}),
			}),
		)

		const result = await response.json()
		expect(response.status, JSON.stringify(result)).toBe(200)
		expect(result).toMatchObject({
			choices: [
				{
					finish_reason: "stop",
				},
			],
			usage: {
				prompt_tokens: 3,
				completion_tokens: 2,
				total_tokens: 5,
				prompt_tokens_details: {
					cached_tokens: 1,
				},
				completion_tokens_details: {
					reasoning_tokens: 0,
				},
			},
		})

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("rejects previous_response_id on the stateless responses endpoint", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn()
		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			ensureFresh: false,
			fetch,
		})

		const response = await handler(
			new Request("http://localhost/v1/responses", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "gpt-5.2",
					stream: false,
					previous_response_id: "resp_1",
					input: [],
				}),
			}),
		)

		expect(response.status).toBe(400)
		expect(fetch).not.toHaveBeenCalled()
	})

	test("rejects item_reference without an upstream request in explicit stateless mode", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn()
		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			ensureFresh: false,
			fetch,
			responsesState: "stateless",
		})

		const response = await handler(
			new Request("http://localhost/v1/responses", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: "gpt-5.6-sol",
					input: [{ type: "item_reference", id: "fc_1" }],
					stream: true,
				}),
			}),
		)

		expect(response.status).toBe(400)
		expect(fetch).not.toHaveBeenCalled()

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("replays a Posit-shaped streamed tool continuation in memory mode", async () => {
		const authFilePath = await createAuthFile()
		let responseRequestCount = 0
		const fetch = vi.fn(
			async (input: RequestInfo | URL, _init?: RequestInit) => {
				if (String(input).includes("/backend-api/codex/models?")) {
					return Response.json({
						models: [{ slug: "gpt-5.6-sol", visibility: "list" }],
					})
				}

				responseRequestCount += 1
				if (responseRequestCount === 1) {
					return createSseResponse([
						[
							"response.created",
							{
								type: "response.created",
								response: { id: "resp_1", status: "in_progress" },
							},
						],
						[
							"response.output_item.done",
							{
								type: "response.output_item.done",
								output_index: 0,
								item: {
									type: "reasoning",
									id: "rs_1",
									encrypted_content: "encrypted-reasoning",
									summary: [],
								},
							},
						],
						[
							"response.output_item.done",
							{
								type: "response.output_item.done",
								output_index: 1,
								item: {
									type: "function_call",
									id: "fc_1",
									call_id: "call_1",
									name: "inspect_r_environment",
									arguments: "{}",
									status: "completed",
								},
							},
						],
						[
							"response.completed",
							{
								type: "response.completed",
								response: {
									id: "resp_1",
									status: "completed",
									output: [],
								},
							},
						],
					])
				}

				return createSseResponse([
					[
						"response.completed",
						{
							type: "response.completed",
							response: {
								id: "resp_2",
								status: "completed",
								output: [
									{
										type: "message",
										id: "msg_2",
										role: "assistant",
										content: [
											{ type: "output_text", text: "Found two objects." },
										],
									},
								],
							},
						},
					],
				])
			},
		)
		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			ensureFresh: false,
			fetch,
			responsesState: "memory",
		})

		const firstInput = {
			role: "user",
			content: [{ type: "input_text", text: "Inspect the R environment." }],
		}
		const firstResponse = await handler(
			new Request("http://localhost/v1/responses", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: "gpt-5.6-sol",
					input: [firstInput],
					reasoning: { effort: "medium", summary: "detailed" },
					tools: [
						{
							type: "function",
							name: "inspect_r_environment",
							parameters: { type: "object", properties: {} },
						},
					],
					stream: true,
				}),
			}),
		)
		expect(firstResponse.status).toBe(200)
		await firstResponse.text()

		const toolOutput = {
			type: "function_call_output",
			call_id: "call_1",
			output: '{"objects":["fit","counts"]}',
		}
		const secondResponse = await handler(
			new Request("http://localhost/v1/responses", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: "gpt-5.6-sol",
					previous_response_id: "resp_1",
					input: [toolOutput],
					reasoning: { effort: "medium", summary: "detailed" },
					stream: true,
				}),
			}),
		)
		expect(secondResponse.status).toBe(200)
		await secondResponse.text()

		const calls = upstreamResponseCalls(fetch)
		expect(calls).toHaveLength(2)
		const [, secondInit] = calls[1] ?? []
		const replayed = JSON.parse(String(secondInit?.body))
		expect(replayed.previous_response_id).toBeUndefined()
		expect(replayed.input).toEqual([
			firstInput,
			{
				type: "reasoning",
				id: "rs_1",
				encrypted_content: "encrypted-reasoning",
				summary: [],
			},
			{
				type: "function_call",
				id: "fc_1",
				call_id: "call_1",
				name: "inspect_r_environment",
				arguments: "{}",
				status: "completed",
			},
			toolOutput,
		])

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("exposes OpenAI-compatible image generation and edit routes", async () => {
		const authFilePath = await createAuthFile()
		const requests: Array<{ path: string; body: Record<string, unknown> }> = []
		const fetch = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = new URL(String(input))
				requests.push({
					path: url.pathname,
					body: JSON.parse(String(init?.body)),
				})
				return Response.json(
					{
						created: 1,
						data: [{ b64_json: "AQID" }],
						usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
					},
					{
						headers: {
							"content-encoding": "gzip",
							"content-length": "999",
						},
					},
				)
			},
		)
		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			ensureFresh: false,
			fetch,
		})

		const generated = await handler(
			new Request("http://localhost/v1/images/generations", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ prompt: "draw a square" }),
			}),
		)
		const editBody = new FormData()
		editBody.set("prompt", "add a red hat")
		editBody.set(
			"image",
			new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
			"input.png",
		)
		const edited = await handler(
			new Request("http://localhost/v1/images/edits", {
				method: "POST",
				body: editBody,
			}),
		)

		expect(generated.status).toBe(200)
		expect(edited.status).toBe(200)
		expect(generated.headers.get("content-encoding")).toBeNull()
		expect(generated.headers.get("content-length")).toBeNull()
		await expect(generated.json()).resolves.toMatchObject({
			data: [{ b64_json: "AQID" }],
			usage: { total_tokens: 5 },
		})
		await expect(edited.json()).resolves.toMatchObject({
			data: [{ b64_json: "AQID" }],
		})
		expect(requests).toEqual([
			{
				path: "/backend-api/codex/images/generations",
				body: { model: "gpt-image-2", prompt: "draw a square" },
			},
			{
				path: "/backend-api/codex/images/edits",
				body: {
					images: [{ image_url: "data:image/png;base64,AQID" }],
					model: "gpt-image-2",
					prompt: "add a red hat",
				},
			},
		])
	})

	test("emits a chat error log when messages is invalid", async () => {
		const requestLogger = vi.fn()
		const handler = createOpenAIOAuthFetchHandler({
			requestLogger,
		})

		const response = await handler(
			new Request("http://localhost/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "gpt-5.4",
					messages: "not-an-array",
				}),
			}),
		)

		expect(response.status).toBe(400)
		expect(requestLogger).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "chat_error",
				path: "/v1/chat/completions",
				message: "`messages` must be an array.",
			}),
		)
	})
})
