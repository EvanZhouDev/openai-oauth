import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
	createOpenAIOAuthRequest,
	deriveAccountId,
	deriveChatGptAccountIsFedRamp,
	exchangeOpenAIOAuthCode,
	parseJwtClaims,
	refreshOpenAIOAuthTokens,
} from "@openai-oauth/core"
import { describe, expect, test, vi } from "vitest"
import { loadAuthTokens, saveAuthTokens } from "../src/auth-file.js"

const encodeBase64Url = (value: Record<string, unknown>): string =>
	Buffer.from(JSON.stringify(value)).toString("base64url")

const createJwt = (payload: Record<string, unknown>): string => {
	const header = encodeBase64Url({ alg: "none", typ: "JWT" })
	const body = encodeBase64Url(payload)
	return `${header}.${body}.signature`
}

const writeAuthFile = async (filePath: string, data: unknown) => {
	await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8")
}

describe("auth helpers", () => {
	test("parseJwtClaims returns undefined for invalid tokens", () => {
		expect(parseJwtClaims(undefined)).toBeUndefined()
		expect(parseJwtClaims("not-a-jwt")).toBeUndefined()
	})

	test("parseJwtClaims returns payload for valid tokens", () => {
		expect(parseJwtClaims(createJwt({ sub: "user-1" }))).toEqual({
			sub: "user-1",
		})
	})

	test("deriveAccountId reads account id claim", () => {
		expect(
			deriveAccountId(
				createJwt({
					"https://api.openai.com/auth": { chatgpt_account_id: "acct-1" },
				}),
			),
		).toBe("acct-1")
	})

	test("derives the FedRAMP routing claim", () => {
		expect(
			deriveChatGptAccountIsFedRamp(
				createJwt({
					"https://api.openai.com/auth": {
						chatgpt_account_is_fedramp: true,
					},
				}),
			),
		).toBe(true)
	})

	test("createOpenAIOAuthRequest builds a PKCE authorize URL", async () => {
		const request = await createOpenAIOAuthRequest({
			redirectUri: "http://127.0.0.1:1234/auth/callback",
			state: "state-1",
			codeVerifier: "verifier-1",
			clientId: "client-1",
			extraParams: {
				originator: "ignored",
			},
		})
		const url = new URL(request.authorizationUrl)

		expect(url.origin).toBe("https://auth.openai.com")
		expect(url.pathname).toBe("/oauth/authorize")
		expect(url.searchParams.get("response_type")).toBe("code")
		expect(url.searchParams.get("client_id")).toBe("client-1")
		expect(url.searchParams.get("state")).toBe("state-1")
		expect(url.searchParams.get("redirect_uri")).toBe(
			"http://127.0.0.1:1234/auth/callback",
		)
		expect(url.searchParams.get("scope")).toBe(
			"openid profile email offline_access",
		)
		expect(url.searchParams.get("code_challenge")).toBe(
			createHash("sha256").update("verifier-1").digest("base64url"),
		)
		expect(url.searchParams.get("code_challenge_method")).toBe("S256")
		expect(url.searchParams.get("codex_cli_simplified_flow")).toBe("true")
		expect(url.searchParams.get("id_token_add_organizations")).toBe("true")
		expect(url.searchParams.has("originator")).toBe(false)
	})

	test("exchangeOpenAIOAuthCode sends authorization_code token request", async () => {
		const idToken = createJwt({
			"https://api.openai.com/auth": { chatgpt_account_id: "acct-1" },
		})
		const fetch = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					access_token: "access",
					refresh_token: "refresh",
					id_token: idToken,
					expires_in: 3600,
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			)
		})

		const token = await exchangeOpenAIOAuthCode({
			code: "code-1",
			codeVerifier: "verifier-1",
			redirectUri: "http://127.0.0.1:1234/auth/callback",
			clientId: "client-1",
			fetch,
		})

		expect(token.accessToken).toBe("access")
		expect(token.refreshToken).toBe("refresh")
		expect(token.idToken).toBe(idToken)
		expect(token.accountId).toBe("acct-1")

		const [, init] = fetch.mock.calls[0] ?? []
		expect(init).toMatchObject({
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
		})
		expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual(
			{
				grant_type: "authorization_code",
				code: "code-1",
				redirect_uri: "http://127.0.0.1:1234/auth/callback",
				client_id: "client-1",
				code_verifier: "verifier-1",
			},
		)
	})

	test("refreshOpenAIOAuthTokens uses the current Codex refresh payload", async () => {
		const fetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ access_token: "new-access" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		)

		await refreshOpenAIOAuthTokens({
			refreshToken: "refresh-1",
			clientId: "client-1",
			fetch,
		})

		const [, init] = fetch.mock.calls[0] ?? []
		expect(JSON.parse(String(init?.body))).toEqual({
			grant_type: "refresh_token",
			refresh_token: "refresh-1",
			client_id: "client-1",
		})
	})

	test("saveAuthTokens writes a Codex-compatible auth file", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "auth-save-"))
		const authPath = path.join(root, "auth.json")
		const idToken = createJwt({
			"https://api.openai.com/auth": { chatgpt_account_id: "acct-1" },
		})

		try {
			const saved = await saveAuthTokens({
				authFilePath: authPath,
				now: () => new Date("2025-01-01T00:00:00Z"),
				token: {
					accessToken: "access",
					refreshToken: "refresh",
					idToken,
					raw: {},
				},
			})

			const written = JSON.parse(await fs.readFile(authPath, "utf-8"))
			expect(saved.path).toBe(authPath)
			expect(saved.auth.accountId).toBe("acct-1")
			expect(written).toEqual({
				auth_mode: "chatgpt",
				tokens: {
					id_token: idToken,
					access_token: "access",
					refresh_token: "refresh",
					account_id: "acct-1",
				},
				last_refresh: "2025-01-01T00:00:00.000Z",
			})
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})
})

describe("loadAuthTokens", () => {
	test("throws when access token is missing", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "auth-missing-"))
		const authPath = path.join(root, "auth.json")
		const fetch =
			globalThis.fetch ??
			(async () => {
				throw new Error("unused")
			})

		try {
			await writeAuthFile(authPath, {
				tokens: {
					refresh_token: "refresh",
					account_id: "acct-1",
				},
			})

			await expect(
				loadAuthTokens({
					authFilePath: authPath,
					fetch,
					ensureFresh: false,
				}),
			).rejects.toThrow("ChatGPT access token not found")
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})

	test("returns stored tokens when refresh is not required", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "auth-basic-"))
		const authPath = path.join(root, "auth.json")
		const fetch =
			globalThis.fetch ??
			(async () => {
				throw new Error("unused")
			})

		try {
			await writeAuthFile(authPath, {
				tokens: {
					access_token: "access",
					refresh_token: "refresh",
					account_id: "acct-1",
				},
			})

			const result = await loadAuthTokens({
				authFilePath: authPath,
				fetch,
				ensureFresh: false,
			})

			expect(result.accessToken).toBe("access")
			expect(result.accountId).toBe("acct-1")
			expect(result.sourcePath).toBe(authPath)
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})

	test("refreshes tokens when access token is expired", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "auth-refresh-"))
		const authPath = path.join(root, "auth.json")
		const now = new Date("2025-01-01T00:00:00Z")
		const expiredToken = createJwt({
			exp: Math.floor(now.getTime() / 1000) - 10,
			"https://api.openai.com/auth": {
				chatgpt_account_is_fedramp: true,
			},
		})
		const refreshedIdToken = createJwt({
			"https://api.openai.com/auth": { chatgpt_account_id: "acct-2" },
		})

		const fetch = async () =>
			new Response(
				JSON.stringify({
					access_token: "new-access",
					id_token: refreshedIdToken,
					refresh_token: "new-refresh",
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			)

		try {
			await writeAuthFile(authPath, {
				tokens: {
					access_token: expiredToken,
					refresh_token: "refresh",
				},
				last_refresh: "2020-01-01T00:00:00Z",
			})

			const result = await loadAuthTokens({
				authFilePath: authPath,
				fetch,
				now: () => now,
			})

			expect(result.accessToken).toBe("new-access")
			expect(result.accountId).toBe("acct-2")
			expect(result.isFedRamp).toBe(true)
			expect(result.refreshToken).toBe("new-refresh")

			const updated = JSON.parse(await fs.readFile(authPath, "utf-8"))
			expect(updated.last_refresh).toBe(now.toISOString())
			expect(updated.tokens.access_token).toBe("new-access")
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})

	test("uses an explicit token url override when refreshing", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "auth-token-url-"))
		const authPath = path.join(root, "auth.json")
		const now = new Date("2025-01-01T00:00:00Z")
		const expiredToken = createJwt({
			exp: Math.floor(now.getTime() / 1000) - 10,
		})
		const fetch = vi.fn(async () => {
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
		})

		try {
			await writeAuthFile(authPath, {
				tokens: {
					access_token: expiredToken,
					refresh_token: "refresh",
					account_id: "acct-1",
				},
				last_refresh: "2020-01-01T00:00:00Z",
			})

			await loadAuthTokens({
				authFilePath: authPath,
				fetch,
				now: () => now,
				tokenUrl: "https://auth.example.com/custom/token",
			})

			expect(fetch).toHaveBeenCalledWith(
				"https://auth.example.com/custom/token",
				expect.objectContaining({
					method: "POST",
				}),
			)
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})
})
