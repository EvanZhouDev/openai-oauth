import { afterEach, describe, expect, test, vi } from "vitest"
import {
	completeLogin,
	exchangeCode,
	isBrowserExtensionInstalled,
	openaiAuthHeaders,
	openaiOAuthBrowserExtensionId,
	refreshSession,
	startLogin,
} from "../src/index.js"
import { openaiCredentials } from "../src/server.js"

const createToken = (accountId: string): string =>
	[
		Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
			"base64url",
		),
		Buffer.from(
			JSON.stringify({
				"https://api.openai.com/auth": {
					chatgpt_account_id: accountId,
				},
			}),
		).toString("base64url"),
		"signature",
	].join(".")

afterEach(() => {
	vi.unstubAllGlobals()
})

const decodeRelayState = (state: string): Record<string, unknown> =>
	JSON.parse(Buffer.from(state.slice("oo2_".length), "base64url").toString())

describe("@openai-oauth/web", () => {
	test("detects the browser extension through the installed marker", async () => {
		const fetchImpl = vi.fn(async () =>
			Response.json({ installed: true, name: "sign-in-with-chatgpt" }),
		)

		await expect(
			isBrowserExtensionInstalled({ fetch: fetchImpl, timeoutMs: 0 }),
		).resolves.toBe(true)

		expect(fetchImpl).toHaveBeenCalledWith(
			`chrome-extension://${openaiOAuthBrowserExtensionId}/src/installed.json`,
			expect.objectContaining({
				cache: "no-store",
			}),
		)
	})

	test("treats missing or invalid browser extension markers as not installed", async () => {
		const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }))

		await expect(
			isBrowserExtensionInstalled({
				extensionId: "not-a-chrome-extension-id",
				fetch: fetchImpl,
				timeoutMs: 0,
			}),
		).resolves.toBe(false)
		expect(fetchImpl).not.toHaveBeenCalled()

		await expect(
			isBrowserExtensionInstalled({ fetch: fetchImpl, timeoutMs: 0 }),
		).resolves.toBe(false)
	})

	test("startLogin defaults to the browser-extension relay callback", async () => {
		const assign = vi.fn()
		const setItem = vi.fn()
		vi.stubGlobal("window", {
			location: {
				href: "https://app.example.test/dashboard?tab=ai#top",
				origin: "https://app.example.test",
				pathname: "/dashboard",
				search: "?tab=ai",
				hash: "#top",
				assign,
			},
			sessionStorage: {
				getItem: vi.fn(() => null),
				setItem,
				removeItem: vi.fn(),
			},
		} as unknown as Window)

		const request = await startLogin({ codeVerifier: "verifier-1" })
		const url = new URL(request.authorizationUrl)
		const state = url.searchParams.get("state")
		expect(state).toBeTypeOf("string")

		expect(assign).toHaveBeenCalledWith(request.authorizationUrl)
		expect(url.searchParams.get("redirect_uri")).toBe(
			"http://localhost:1455/auth/callback",
		)
		expect(state?.startsWith("oo2_")).toBe(true)
		expect(decodeRelayState(state ?? "")).toMatchObject({
			type: "openai-oauth-callback",
			version: 1,
			callbackUrl: "https://app.example.test/dashboard?tab=ai#top",
		})
		expect(JSON.parse(setItem.mock.calls[0]?.[1] ?? "{}")).toMatchObject({
			state,
			redirectUri: "http://localhost:1455/auth/callback",
			returnTo: "/dashboard?tab=ai#top",
		})
	})

	test("startLogin preserves caller state inside browser-extension relay state", async () => {
		vi.stubGlobal("window", {
			location: {
				href: "https://app.example.test/",
				origin: "https://app.example.test",
				pathname: "/",
				search: "",
				hash: "",
				assign: vi.fn(),
			},
			sessionStorage: {
				getItem: vi.fn(() => null),
				setItem: vi.fn(),
				removeItem: vi.fn(),
			},
		} as unknown as Window)

		const request = await startLogin({
			codeVerifier: "verifier-1",
			state: "caller-state",
		})
		const url = new URL(request.authorizationUrl)
		const state = url.searchParams.get("state") ?? ""

		expect(state.startsWith("oo2_")).toBe(true)
		expect(decodeRelayState(state)).toMatchObject({
			appState: "caller-state",
			callbackUrl: "https://app.example.test/",
		})
	})

	test("startLogin can still use the current origin callback", async () => {
		const assign = vi.fn()
		vi.stubGlobal("window", {
			location: {
				href: "https://app.example.test/",
				origin: "https://app.example.test",
				pathname: "/",
				search: "",
				hash: "",
				assign,
			},
			sessionStorage: {
				getItem: vi.fn(() => null),
				setItem: vi.fn(),
				removeItem: vi.fn(),
			},
		} as unknown as Window)

		const request = await startLogin({
			callbackMode: "current-origin",
			codeVerifier: "verifier-1",
			state: "state-1",
		})
		const url = new URL(request.authorizationUrl)

		expect(assign).toHaveBeenCalledWith(request.authorizationUrl)
		expect(url.searchParams.get("redirect_uri")).toBe(
			"https://app.example.test/auth/callback",
		)
		expect(url.searchParams.get("state")).toBe("state-1")
	})

	test("completeLogin keeps an existing session on stale callback reloads", async () => {
		const session = {
			accessToken: "access-token",
			accountId: "acct-1",
			refreshToken: "refresh-token",
		}
		const sessionStore = {
			get: vi.fn(async () => session),
			set: vi.fn(async () => {}),
			clear: vi.fn(async () => {}),
		}
		const replaceState = vi.fn()
		vi.stubGlobal("window", {
			location: {
				href: "https://app.example.test/auth/callback?code=stale&state=old",
				origin: "https://app.example.test",
				pathname: "/auth/callback",
				search: "?code=stale&state=old",
				hash: "",
			},
			history: {
				replaceState,
			},
			sessionStorage: {
				getItem: vi.fn(() => null),
				setItem: vi.fn(),
				removeItem: vi.fn(),
			},
		} as unknown as Window)

		await expect(completeLogin({ sessionStore })).resolves.toEqual(session)
		expect(sessionStore.set).not.toHaveBeenCalled()
		expect(replaceState).toHaveBeenCalledWith(null, "", "/")
	})

	test("completeLogin clears pending browser-extension cancellation callbacks", async () => {
		const pending = {
			state: "oo2_state",
			codeVerifier: "verifier-1",
			redirectUri: "http://localhost:1455/auth/callback",
			returnTo: "/dashboard?tab=ai#top",
		}
		const replaceState = vi.fn()
		const removeItem = vi.fn()
		const sessionStore = {
			get: vi.fn(async () => null),
			set: vi.fn(async () => {}),
			clear: vi.fn(async () => {}),
		}
		vi.stubGlobal("window", {
			location: {
				href: "https://app.example.test/dashboard?error=access_denied&error_description=Sign-in%20cancelled&state=oo2_state",
				origin: "https://app.example.test",
				pathname: "/dashboard",
				search:
					"?error=access_denied&error_description=Sign-in%20cancelled&state=oo2_state",
				hash: "",
			},
			history: {
				replaceState,
			},
			sessionStorage: {
				getItem: vi.fn(() => JSON.stringify(pending)),
				setItem: vi.fn(),
				removeItem,
			},
		} as unknown as Window)

		await expect(completeLogin({ sessionStore })).resolves.toBeNull()
		expect(removeItem).toHaveBeenCalledWith("openai-oauth:pending-login")
		expect(replaceState).toHaveBeenCalledWith(null, "", "/dashboard?tab=ai#top")
		expect(sessionStore.get).not.toHaveBeenCalled()
		expect(sessionStore.set).not.toHaveBeenCalled()
	})

	test("openaiAuthHeaders returns plain object headers and refreshes expiring stored browser sessions", async () => {
		const accessToken = createToken("acct_refreshed")
		const stored = {
			accessToken: createToken("acct_old"),
			accountId: "acct_old",
			refreshToken: "refresh-token",
			expiresAt: "2026-01-01T00:01:00.000Z",
			lastRefresh: "2026-01-01T00:00:00.000Z",
		}
		const sessionStore = {
			get: vi.fn(async () => stored),
			set: vi.fn(async () => {}),
			clear: vi.fn(async () => {}),
		}
		const fetch = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					access_token: accessToken,
					id_token: accessToken,
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			)
		})
		const headers = await openaiAuthHeaders({
			headers: { "content-type": "application/json" },
			sessionStore,
			fetch,
			now: () => new Date("2026-01-01T00:00:00.000Z"),
			tokenUrl: "https://auth.example.test/oauth/token",
		})

		expect(headers).toMatchObject({
			authorization: `Bearer ${accessToken}`,
			"chatgpt-account-id": "acct_refreshed",
			"content-type": "application/json",
		})
		expect({ ...headers }).toMatchObject({
			authorization: `Bearer ${accessToken}`,
			"chatgpt-account-id": "acct_refreshed",
		})
		expect(sessionStore.set).toHaveBeenCalledWith({
			accessToken,
			accountId: "acct_refreshed",
			idToken: accessToken,
			refreshToken: "refresh-token",
			lastRefresh: "2026-01-01T00:00:00.000Z",
		})
	})

	test("server openaiCredentials reads request-bound auth headers", async () => {
		const credentials = openaiCredentials(
			new Request("https://app.example.test/api/chat", {
				headers: {
					Authorization: "Bearer access-token",
					"chatgpt-account-id": "acct-1",
				},
			}),
		)

		await expect(credentials.getSession()).resolves.toEqual({
			accessToken: "access-token",
			accountId: "acct-1",
		})
	})

	test("exchanges an authorization code for a browser-storable session", async () => {
		const accessToken = createToken("acct_exchange")
		const fetch = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					access_token: accessToken,
					refresh_token: "refresh-token",
					id_token: accessToken,
					expires_in: 3600,
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			)
		})
		await expect(
			exchangeCode(
				{
					code: "auth-code",
					codeVerifier: "verifier",
					redirectUri: "https://app.example.test/auth/callback",
				},
				{
					fetch,
					now: () => new Date("2026-01-01T00:00:00.000Z"),
					tokenUrl: "https://auth.example.test/oauth/token",
				},
			),
		).resolves.toEqual({
			accessToken,
			accountId: "acct_exchange",
			idToken: accessToken,
			refreshToken: "refresh-token",
			expiresAt: "2026-01-01T01:00:00.000Z",
			lastRefresh: "2026-01-01T00:00:00.000Z",
		})

		const [url, init] = fetch.mock.calls[0] ?? []
		expect(url).toBe("https://auth.example.test/oauth/token")
		expect(JSON.parse(String(init?.body))).toMatchObject({
			grant_type: "authorization_code",
			code: "auth-code",
			code_verifier: "verifier",
			redirect_uri: "https://app.example.test/auth/callback",
		})
	})

	test("refreshes sessions and keeps the previous refresh token when none is rotated", async () => {
		const accessToken = createToken("acct_refresh")
		const fetch = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					access_token: accessToken,
					id_token: accessToken,
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			)
		})
		await expect(
			refreshSession(
				{
					refreshToken: "old-refresh-token",
				},
				{
					fetch,
					now: () => new Date("2026-01-01T00:00:00.000Z"),
					tokenUrl: "https://auth.example.test/oauth/token",
				},
			),
		).resolves.toEqual({
			accessToken,
			accountId: "acct_refresh",
			idToken: accessToken,
			refreshToken: "old-refresh-token",
			lastRefresh: "2026-01-01T00:00:00.000Z",
		})

		const [, init] = fetch.mock.calls[0] ?? []
		expect(JSON.parse(String(init?.body))).toMatchObject({
			grant_type: "refresh_token",
			refresh_token: "old-refresh-token",
		})
	})
})
