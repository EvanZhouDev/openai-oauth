import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { deriveAccountId, loadAuthTokens, parseJwtClaims } from "../src/auth.js"

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
		const token = createJwt({ sub: "user-1" })
		expect(parseJwtClaims(token)).toEqual({ sub: "user-1" })
	})

	test("deriveAccountId reads account id claim", () => {
		const token = createJwt({
			"https://api.openai.com/auth": { chatgpt_account_id: "acct-1" },
		})
		expect(deriveAccountId(token)).toBe("acct-1")
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
})
