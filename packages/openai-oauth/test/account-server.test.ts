import { describe, expect, test } from "vitest"
import { startOpenAIOAuthServer } from "../src/server.js"

const encodeBase64Url = (value: string): string =>
	btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")

const createMockJwt = (payload: Record<string, unknown>): string => {
	const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
	const body = encodeBase64Url(JSON.stringify(payload))
	return `${header}.${body}.signature`
}

describe("Account & Quota server endpoints", () => {
	test("returns account info from GET /v1/account", async () => {
		const mockIdToken = createMockJwt({
			sub: "usr-99",
			email: "dev@openai-oauth.local",
			"https://api.openai.com/auth": {
				chatgpt_account_id: "acc-test",
				chatgpt_plan_type: "plus",
			},
		})

		const server = await startOpenAIOAuthServer({
			port: 0,
			auth: () =>
				Promise.resolve({
					accessToken: "mock-access",
					accountId: "acc-test",
					idToken: mockIdToken,
				}),
			models: ["gpt-5.6-terra", "gpt-5.4-mini"],
		})

		try {
			const res = await fetch(`${server.url}/account`)
			expect(res.status).toBe(200)
			const json = (await res.json()) as {
				object: string
				user: { email?: string }
				subscription: { planType?: string }
			}
			expect(json.object).toBe("account")
			expect(json.user.email).toBe("dev@openai-oauth.local")
			expect(json.subscription.planType).toBe("plus")
		} finally {
			await server.close()
		}
	})

	test("returns quota info from GET /v1/quota", async () => {
		const mockIdToken = createMockJwt({
			sub: "usr-99",
			email: "dev@openai-oauth.local",
			"https://api.openai.com/auth": {
				chatgpt_account_id: "acc-test",
				chatgpt_plan_type: "plus",
			},
		})

		const server = await startOpenAIOAuthServer({
			port: 0,
			auth: () =>
				Promise.resolve({
					accessToken: "mock-access",
					accountId: "acc-test",
					idToken: mockIdToken,
				}),
			models: ["gpt-5.6-terra", "gpt-5.4-mini"],
		})

		try {
			const res = await fetch(`${server.url}/quota`)
			expect(res.status).toBe(200)
			const json = (await res.json()) as {
				object: string
				account_email?: string
				plan_type?: string
				models: Record<string, { limit: number }>
			}
			expect(json.object).toBe("quota")
			expect(json.account_email).toBe("dev@openai-oauth.local")
			expect(json.plan_type).toBe("plus")
			expect(json.models["gpt-5.6-terra"]?.limit).toBe(40)
		} finally {
			await server.close()
		}
	})
})
