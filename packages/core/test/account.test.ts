import { describe, expect, test } from "vitest"
import { deriveAccountDetails } from "../src/runtime.js"

const encodeBase64Url = (value: string): string =>
	btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")

const createMockJwt = (payload: Record<string, unknown>): string => {
	const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
	const body = encodeBase64Url(JSON.stringify(payload))
	return `${header}.${body}.signature`
}

describe("deriveAccountDetails", () => {
	test("derives user profile and subscription plan from ID token", () => {
		const exp = Math.floor(Date.now() / 1000) + 3600
		const mockIdToken = createMockJwt({
			sub: "user-12345",
			email: "dev@example.com",
			name: "Jane Dev",
			picture: "https://example.com/avatar.png",
			email_verified: true,
			exp,
			"https://api.openai.com/auth": {
				chatgpt_account_id: "acc-9900",
				chatgpt_plan_type: "plus",
				chatgpt_account_is_fedramp: false,
			},
		})

		const details = deriveAccountDetails(mockIdToken)
		expect(details.user.email).toBe("dev@example.com")
		expect(details.user.id).toBe("user-12345")
		expect(details.subscription.planType).toBe("plus")
		expect(details.subscription.accountId).toBe("acc-9900")
		expect(details.subscription.isFedRamp).toBe(false)
		expect(details.session.status).toBe("active")
	})

	test("handles empty or invalid tokens gracefully", () => {
		const details = deriveAccountDetails(undefined)
		expect(details.user.email).toBeUndefined()
		expect(details.subscription.planType).toBe("unknown")
		expect(details.session.status).toBe("unknown")
	})
})
