import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import {
	calculateTokenCost,
	createOpenAIOAuthFetchHandler,
	formatCost,
	getModelPricing,
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
			replay_state: "stateful",
		})

		const statelessHandler = createOpenAIOAuthFetchHandler({
			responsesState: false,
		})
		const statelessHealth = await statelessHandler(
			new Request("http://localhost/health", {
				method: "GET",
			}),
		)

		await expect(statelessHealth.json()).resolves.toEqual({
			ok: true,
			replay_state: "stateless",
		})
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
			responsesState: false,
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

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("replays previous_response_id using server cache on the stateful responses endpoint", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				if (String(input).includes("/backend-api/codex/models?")) {
					return new Response(
						JSON.stringify({
							models: [{ slug: "gpt-5.2", visibility: "list" }],
						}),
					)
				}
				const url = String(input)
				if (url.endsWith("/backend-api/codex/responses")) {
					const body = JSON.parse(String(init?.body))
					const isSecondTurn = body.input.some(
						(item: { content?: Array<{ text?: string }> }) =>
							item.content?.[0]?.text === "How are you?",
					)
					const respId = isSecondTurn ? "resp_2" : "resp_1"
					const text = isSecondTurn ? "I am well." : "Hello there."
					const stream = new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(
								new TextEncoder().encode(
									[
										"event: response.created",
										`data: {"response":{"id":"${respId}","status":"in_progress"}}`,
										"",
										"event: response.completed",
										`data: {"response":{"id":"${respId}","status":"completed","output":[{"type":"message","id":"msg_${respId}","role":"assistant","content":[{"type":"output_text","text":"${text}"}]}]}}`,
										"",
									].join("\n"),
								),
							)
							controller.close()
						},
					})
					return new Response(stream, { status: 200 })
				}
				return new Response(null, { status: 404 })
			},
		)

		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			ensureFresh: false,
			fetch,
		})

		// Turn 1
		const response1 = await handler(
			new Request("http://localhost/v1/responses", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: "gpt-5.2",
					stream: false,
					input: [
						{ role: "user", content: [{ type: "input_text", text: "Hello" }] },
					],
				}),
			}),
		)
		expect(response1.status).toBe(200)
		const data1 = await response1.json()
		expect(data1.id).toBe("resp_1")

		// Turn 2 with previous_response_id
		const response2 = await handler(
			new Request("http://localhost/v1/responses", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: "gpt-5.2",
					stream: false,
					previous_response_id: "resp_1",
					input: [
						{
							role: "user",
							content: [{ type: "input_text", text: "How are you?" }],
						},
					],
				}),
			}),
		)
		expect(response2.status).toBe(200)
		const data2 = await response2.json()
		expect(data2.id).toBe("resp_2")

		// Verify upstream request 2 had previous_response_id expanded into input
		const responsesCalls = fetch.mock.calls.filter(([input]) =>
			String(input).endsWith("/backend-api/codex/responses"),
		)
		expect(responsesCalls).toHaveLength(2)
		const secondUpstreamBody = JSON.parse(String(responsesCalls[1]?.[1]?.body))
		expect(secondUpstreamBody.previous_response_id).toBeUndefined()
		expect(secondUpstreamBody.input).toEqual([
			{ role: "user", content: [{ type: "input_text", text: "Hello" }] },
			{
				type: "message",
				id: "msg_resp_1",
				role: "assistant",
				content: [{ type: "output_text", text: "Hello there." }],
			},
			{ role: "user", content: [{ type: "input_text", text: "How are you?" }] },
		])

		// Turn 3 with unknown previous_response_id returns 400
		const response3 = await handler(
			new Request("http://localhost/v1/responses", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: "gpt-5.2",
					stream: false,
					previous_response_id: "resp_unknown",
					input: [],
				}),
			}),
		)
		expect(response3.status).toBe(400)
		const data3 = await response3.json()
		expect(data3.error.message).toContain("not found in conversation cache")

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

	test("logs detailed incoming and completed requests when verbose is enabled", async () => {
		const logs: string[] = []
		const handler = createOpenAIOAuthFetchHandler({
			verbose: true,
			logWriter: (msg) => logs.push(msg),
		})

		const healthResponse = await handler(
			new Request("http://localhost/health", { method: "GET" }),
		)
		expect(healthResponse.status).toBe(200)

		// Wait briefly for log completions if async
		expect(logs.some((log) => log.includes("--> GET /health"))).toBe(true)
		expect(logs.some((log) => log.includes("<-- GET /health 200 OK"))).toBe(
			true,
		)

		// Also check error request logging
		const badResponse = await handler(
			new Request("http://localhost/v1/chat/completions", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ model: "gpt-5.4", messages: "invalid" }),
			}),
		)
		expect(badResponse.status).toBe(400)
		expect(
			logs.some((log) =>
				log.includes("--> POST /v1/chat/completions (model: gpt-5.4)"),
			),
		).toBe(true)
		expect(
			logs.some(
				(log) =>
					log.includes("<-- POST /v1/chat/completions 400 Bad Request") &&
					log.includes("messages"),
			),
		).toBe(true)
	})

	test("forwards non-local model requests to OpenRouter using incoming API key", async () => {
		const logs: string[] = []
		const originalFetch = globalThis.fetch
		const fetchMock = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const urlStr = String(input)
				if (urlStr.includes("openrouter.ai")) {
					return new Response(
						JSON.stringify({
							id: "gen-123",
							choices: [
								{ message: { role: "assistant", content: "from openrouter" } },
							],
							usage: {
								prompt_tokens: 100,
								completion_tokens: 20,
								total_tokens: 120,
								prompt_tokens_details: { cached_tokens: 64 },
							},
						}),
						{
							status: 200,
							headers: { "Content-Type": "application/json" },
						},
					)
				}
				return originalFetch(input, init)
			},
		)
		globalThis.fetch = fetchMock as unknown as typeof fetch

		try {
			const handler = createOpenAIOAuthFetchHandler({
				models: ["gpt-6-luna"],
				verbose: true,
				logWriter: (msg) => logs.push(msg),
			})

			const response = await handler(
				new Request("http://localhost/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer sk-or-v1-my-key",
					},
					body: JSON.stringify({
						model: "anthropic/claude-haiku-5.5",
						messages: [{ role: "user", content: "hi" }],
					}),
				}),
			)

			expect(response.status).toBe(200)
			const data = (await response.json()) as {
				choices?: Array<{ message?: { content?: string } }>
			}
			expect(data.choices?.[0]?.message?.content).toBe("from openrouter")

			// Verify OpenRouter was called with target url and forwarded auth header
			expect(fetchMock).toHaveBeenCalled()
			const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? []
			expect(String(calledUrl)).toContain(
				"https://openrouter.ai/api/v1/chat/completions",
			)
			const headers = new Headers(calledInit?.headers)
			expect(headers.get("authorization")).toBe("Bearer sk-or-v1-my-key")

			// Verify logs show fallback and cache tag
			expect(
				logs.some((l) =>
					l.includes(
						"--> POST /v1/chat/completions (model: anthropic/claude-haiku-5.5 -> OpenRouter fallback",
					),
				),
			).toBe(true)
			expect(
				logs.some(
					(l) =>
						l.includes("<-- POST /v1/chat/completions 200 OK") &&
						l.includes("OpenRouter") &&
						l.includes("cached: 64 tokens") &&
						l.includes("cost: $"),
				),
			).toBe(true)
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	test("returns 401 when non-local model is requested without an OpenRouter key", async () => {
		const handler = createOpenAIOAuthFetchHandler({
			models: ["gpt-6-luna"],
		})

		const response = await handler(
			new Request("http://localhost/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer dummy",
				},
				body: JSON.stringify({
					model: "anthropic/claude-haiku-5.5",
					messages: [{ role: "user", content: "hi" }],
				}),
			}),
		)

		expect(response.status).toBe(401)
		const errorData = (await response.json()) as {
			error?: { message?: string }
		}
		expect(errorData.error?.message).toContain(
			"not available in local OpenAI OAuth",
		)
	})

	test("calculates token costs correctly with fallback pricing", async () => {
		const pricing = await getModelPricing("gpt-4o")
		expect(pricing.promptPerToken).toBeGreaterThan(0)
		expect(pricing.completionPerToken).toBeGreaterThan(0)
		expect(pricing.cachedPerToken).toBeGreaterThan(0)

		const cost = calculateTokenCost(pricing, {
			prompt_tokens: 1000,
			cached_tokens: 500,
			completion_tokens: 200,
		})
		expect(cost).toBeGreaterThan(0)

		expect(formatCost(0)).toBe("$0.00")
		expect(formatCost(0.000022)).toBe("$0.000022")
		expect(formatCost(0.0045)).toBe("$0.0045")
		expect(formatCost(1.25)).toBe("$1.25")
	})

	test("injects usage.cost into chat completions and logs saved cost", async () => {
		const authFilePath = await createAuthFile()
		const logs: string[] = []
		const handler = createOpenAIOAuthFetchHandler({
			authFilePath,
			codexVersion: "0.144.1",
			ensureFresh: false,
			verbose: true,
			logWriter: (msg) => logs.push(msg),
			fetch: async (input) => {
				if (String(input).includes("/backend-api/codex/models?")) {
					return Response.json({
						models: [{ slug: "gpt-5.2", visibility: "list" }],
					})
				}

				return new Response(
					[
						"event: response.created",
						'data: {"type":"response.created","response":{"id":"resp_cost","model":"gpt-5.2","created_at":1735689600}}',
						"",
						"event: response.output_item.added",
						'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_1","phase":"final_answer"}}',
						"",
						"event: response.output_text.delta",
						'data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"hi"}',
						"",
						"event: response.output_item.done",
						'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_1","phase":"final_answer"}}',
						"",
						"event: response.completed",
						'data: {"type":"response.completed","response":{"id":"resp_cost","model":"gpt-5.2","created_at":1735689600,"status":"completed","output":[],"usage":{"input_tokens":100,"input_tokens_details":{"cached_tokens":40},"output_tokens":20}}}',
						"",
						"",
					].join("\n"),
					{ headers: { "Content-Type": "text/event-stream" } },
				)
			},
		})

		const response = await handler(
			new Request("http://localhost/v1/chat/completions", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: "gpt-5.2",
					messages: [{ role: "user", content: "hi" }],
				}),
			}),
		)

		expect(response.status).toBe(200)
		const data = (await response.json()) as {
			usage?: { cost?: number; prompt_tokens?: number }
		}
		expect(typeof data.usage?.cost).toBe("number")
		expect(data.usage?.cost).toBeGreaterThan(0)

		// Check verbose logs contain cost tag and (saved) annotation for local model
		expect(
			logs.some(
				(l) =>
					l.includes("<-- POST /v1/chat/completions 200 OK") &&
					l.includes("cached: 40 tokens") &&
					l.includes("cost: $") &&
					l.includes("(saved)"),
			),
		).toBe(true)

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})
})
