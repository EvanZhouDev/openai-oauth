import { access } from "node:fs/promises"
import { afterEach, describe, expect, test, vi } from "vitest"
import { resolveClaudeExecutable } from "../src/claude-login.js"
import {
	createOpenAIOAuthFetchHandler,
	startOpenAIOAuthServer,
} from "../src/index.js"

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: queryMock }))

const queryResult = (...messages: unknown[]) =>
	(async function* () {
		for (const message of messages) {
			yield message
		}
	})()

const successResult = {
	type: "result",
	subtype: "success",
	result: "Hello from Claude",
	stop_reason: "end_turn",
	usage: {
		input_tokens: 12,
		output_tokens: 3,
		cache_read_input_tokens: 2,
	},
}

describe("Claude subscription support", () => {
	afterEach(() => {
		queryMock.mockReset()
		vi.unstubAllEnvs()
	})

	test("lists Claude aliases when enabled", async () => {
		const handler = createOpenAIOAuthFetchHandler({
			models: ["gpt-test"],
			claude: true,
		})
		const response = await handler(new Request("http://localhost/v1/models"))
		const body = (await response.json()) as {
			data: Array<{ id: string; owned_by: string }>
		}

		expect(body.data).toEqual([
			{ id: "gpt-test", object: "model", created: 0, owned_by: "codex-oauth" },
			{
				id: "claude-sonnet",
				object: "model",
				created: 0,
				owned_by: "anthropic-subscription",
			},
			{
				id: "claude-opus",
				object: "model",
				created: 0,
				owned_by: "anthropic-subscription",
			},
			{
				id: "claude-haiku",
				object: "model",
				created: 0,
				owned_by: "anthropic-subscription",
			},
		])
	})

	test("resolves the Agent SDK's bundled login executable", async () => {
		await expect(access(resolveClaudeExecutable())).resolves.toBeUndefined()
	})

	test("uses only subscription authentication for Claude chats", async () => {
		vi.stubEnv("ANTHROPIC_API_KEY", "must-not-be-used")
		vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "must-not-be-used")
		queryMock.mockReturnValue(queryResult(successResult))
		const handler = createOpenAIOAuthFetchHandler({
			models: ["gpt-test"],
			claude: true,
		})

		const response = await handler(
			new Request("http://localhost/v1/chat/completions", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					model: "claude-sonnet",
					messages: [
						{ role: "system", content: "Be concise." },
						{ role: "user", content: "Hello" },
					],
				}),
			}),
		)
		const body = (await response.json()) as {
			choices: Array<{ message: { content: string } }>
			usage: { prompt_tokens: number; completion_tokens: number }
		}

		expect(response.status).toBe(200)
		expect(body.choices[0]?.message.content).toBe("Hello from Claude")
		expect(body.usage).toMatchObject({
			prompt_tokens: 12,
			completion_tokens: 3,
		})
		const call = queryMock.mock.calls[0]?.[0]
		expect(call.options).toMatchObject({
			model: "sonnet",
			tools: [],
			settingSources: [],
			persistSession: false,
			maxTurns: 1,
		})
		expect(call.options.env).not.toHaveProperty("ANTHROPIC_API_KEY")
		expect(call.options.env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN")
		expect(call.options.systemPrompt).toContain("Be concise.")
		expect(JSON.parse(call.prompt)).toEqual([
			{ role: "user", content: "Hello" },
		])
	})

	test("streams Claude text as OpenAI chunks", async () => {
		queryMock.mockReturnValue(
			queryResult(
				{
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "Hello" },
					},
				},
				successResult,
			),
		)
		const handler = createOpenAIOAuthFetchHandler({
			models: ["gpt-test"],
			claude: true,
		})
		const response = await handler(
			new Request("http://localhost/v1/chat/completions", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					model: "claude-opus",
					stream: true,
					messages: [{ role: "user", content: "Hello" }],
				}),
			}),
		)
		const body = await response.text()

		expect(response.headers.get("content-type")).toContain("text/event-stream")
		expect(body).toContain('"content":"Hello"')
		expect(body).toContain('"completion_tokens":3')
		expect(body).toContain("data: [DONE]")
		expect(queryMock.mock.calls[0]?.[0].options).toMatchObject({
			model: "opus",
			includePartialMessages: true,
		})
	})

	test("rejects tools and non-loopback serving", async () => {
		const handler = createOpenAIOAuthFetchHandler({
			models: ["gpt-test"],
			claude: true,
		})
		const response = await handler(
			new Request("http://localhost/v1/chat/completions", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					model: "claude-haiku",
					messages: [{ role: "user", content: "Hello" }],
					tools: [{ type: "function" }],
				}),
			}),
		)

		expect(response.status).toBe(400)
		expect(queryMock).not.toHaveBeenCalled()
		await expect(
			startOpenAIOAuthServer({
				models: ["gpt-test"],
				claude: true,
				host: "0.0.0.0",
			}),
		).rejects.toThrow("loopback")
	})
})
