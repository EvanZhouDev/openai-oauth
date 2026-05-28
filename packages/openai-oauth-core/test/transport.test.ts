import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import {
	collectCompletedResponseFromSse,
	createCodexOAuthFetch,
	normalizeCodexResponsesBody,
} from "../src/index.js"

const createAuthFile = async (): Promise<string> => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-oauth-core-"))
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

const encodeBase64Url = (value: Record<string, unknown>): string =>
	Buffer.from(JSON.stringify(value)).toString("base64url")

const createJwt = (payload: Record<string, unknown>): string => {
	const header = encodeBase64Url({ alg: "none", typ: "JWT" })
	const body = encodeBase64Url(payload)
	return `${header}.${body}.signature`
}

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

	test("preserves caller-provided instructions and explicit store", () => {
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
		expect(normalized.store).toBe(true)
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

	test("allows callers to override the store default", () => {
		const normalized = normalizeCodexResponsesBody(
			{
				model: "gpt-5.2",
			},
			{
				store: false,
			},
		)

		expect(normalized.store).toBe(false)
	})
})

describe("createCodexOAuthFetch", () => {
	test("injects oauth headers and normalizes responses requests", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn(async () => new Response(null, { status: 200 }))

		const oauthFetch = createCodexOAuthFetch({
			authFilePath,
			ensureFresh: false,
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

		expect(fetch).toHaveBeenCalledTimes(1)
		expect(fetch).toHaveBeenCalledWith(
			"https://chatgpt.com/backend-api/codex/responses",
			expect.objectContaining({
				headers: expect.any(Headers),
				body: expect.any(String),
			}),
		)

		const [, init] = fetch.mock.calls[0] ?? []
		const headers = new Headers(init?.headers)
		const body = JSON.parse(String(init?.body))

		expect(headers.get("authorization")).toMatch(/^Bearer /)
		expect(headers.get("chatgpt-account-id")).toBeTruthy()
		expect(body.instructions).toBe("core-instructions")
		expect(body.store).toBe(false)
		expect(body.max_output_tokens).toBeUndefined()

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("preserves absolute codex urls without duplicating the upstream path", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn(async () => new Response(null, { status: 200 }))

		const oauthFetch = createCodexOAuthFetch({
			authFilePath,
			ensureFresh: false,
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

		expect(fetch).toHaveBeenCalledTimes(1)
		expect(fetch).toHaveBeenCalledWith(
			"https://chatgpt.com/backend-api/codex/responses?foo=bar",
			expect.any(Object),
		)

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("supports relative response paths", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn(async () => new Response(null, { status: 200 }))

		const oauthFetch = createCodexOAuthFetch({
			authFilePath,
			ensureFresh: false,
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

		expect(fetch).toHaveBeenCalledTimes(1)
		expect(fetch).toHaveBeenCalledWith(
			"https://chatgpt.com/backend-api/codex/responses",
			expect.any(Object),
		)

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("can disable local replay state entirely", async () => {
		const authFilePath = await createAuthFile()
		const fetch = vi.fn(async () => new Response(null, { status: 200 }))

		const oauthFetch = createCodexOAuthFetch({
			authFilePath,
			ensureFresh: false,
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

		const [, init] = fetch.mock.calls[0] ?? []
		expect(JSON.parse(String(init?.body))).toMatchObject({
			model: "gpt-5.2",
			previous_response_id: "resp_1",
			input: [],
			store: false,
			instructions: "",
		})

		await fs.rm(path.dirname(authFilePath), {
			recursive: true,
			force: true,
		})
	})

	test("passes token url overrides through auth refresh", async () => {
		const root = await fs.mkdtemp(
			path.join(os.tmpdir(), "codex-oauth-refresh-"),
		)
		const authFilePath = path.join(root, "auth.json")
		const now = new Date("2025-01-01T00:00:00Z")
		const expiredToken = [
			Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
				"base64url",
			),
			Buffer.from(
				JSON.stringify({
					exp: Math.floor(now.getTime() / 1000) - 10,
				}),
			).toString("base64url"),
			"signature",
		].join(".")
		const fetch = vi.fn(async (input: RequestInfo | URL) => {
			if (String(input) === "https://auth.example.com/custom/token") {
				return new Response(
					JSON.stringify({
						access_token: "new-access",
						refresh_token: "new-refresh",
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				)
			}

			return new Response(null, { status: 200 })
		})

		try {
			await fs.writeFile(
				authFilePath,
				JSON.stringify(
					{
						tokens: {
							access_token: expiredToken,
							refresh_token: "refresh",
							account_id: "acct-1",
						},
						last_refresh: "2020-01-01T00:00:00Z",
					},
					null,
					2,
				),
				"utf-8",
			)

			const oauthFetch = createCodexOAuthFetch({
				authFilePath,
				fetch,
				now: () => now,
				tokenUrl: "https://auth.example.com/custom/token",
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

			expect(fetch).toHaveBeenCalledWith(
				"https://auth.example.com/custom/token",
				expect.objectContaining({
					method: "POST",
				}),
			)
		} finally {
			await fs.rm(root, {
				recursive: true,
				force: true,
			})
		}
	})

	test("refreshes cached auth after the refresh interval elapses", async () => {
		const root = await fs.mkdtemp(
			path.join(os.tmpdir(), "codex-oauth-refresh-cache-"),
		)
		const authFilePath = path.join(root, "auth.json")
		const initialNow = new Date("2025-01-01T00:00:00Z")
		let now = initialNow
		const initialToken = createJwt({
			exp: Math.floor(new Date("2025-01-02T00:00:00Z").getTime() / 1000),
		})
		const refreshedToken = createJwt({
			exp: Math.floor(new Date("2025-01-03T00:00:00Z").getTime() / 1000),
		})
		const fetch = vi.fn(async (input: RequestInfo | URL) => {
			if (String(input) === "https://auth.example.com/custom/token") {
				return new Response(
					JSON.stringify({
						access_token: refreshedToken,
						refresh_token: "new-refresh",
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				)
			}

			return new Response(null, { status: 200 })
		})

		try {
			await fs.writeFile(
				authFilePath,
				JSON.stringify(
					{
						tokens: {
							access_token: initialToken,
							refresh_token: "refresh",
							account_id: "acct-1",
						},
						last_refresh: initialNow.toISOString(),
					},
					null,
					2,
				),
				"utf-8",
			)

			const oauthFetch = createCodexOAuthFetch({
				authFilePath,
				fetch,
				now: () => now,
				tokenUrl: "https://auth.example.com/custom/token",
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

			now = new Date(initialNow.getTime() + 56 * 60 * 1000)

			await oauthFetch("responses", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "gpt-5.2",
				}),
			})

			expect(fetch).toHaveBeenCalledWith(
				"https://auth.example.com/custom/token",
				expect.objectContaining({
					method: "POST",
				}),
			)

			const secondUpstreamCall = fetch.mock.calls.filter(
				([input]) =>
					String(input) === "https://chatgpt.com/backend-api/codex/responses",
			)[1]
			const headers = new Headers(secondUpstreamCall?.[1]?.headers)
			expect(headers.get("authorization")).toBe(`Bearer ${refreshedToken}`)
		} finally {
			await fs.rm(root, {
				recursive: true,
				force: true,
			})
		}
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
})
