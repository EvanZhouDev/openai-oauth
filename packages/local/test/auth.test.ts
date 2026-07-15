import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { openaiCredentials } from "../src/index.js"

const writeAuthFile = async (filePath: string, data: unknown) => {
	await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8")
}

describe("openaiCredentials", () => {
	test("reads a Codex auth file as an OpenAI OAuth auth handle", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-auth-"))
		const authPath = path.join(root, "auth.json")
		const fetch =
			globalThis.fetch ??
			(async () => {
				throw new Error("unused")
			})

		try {
			await writeAuthFile(authPath, {
				tokens: {
					access_token: "access-token",
					id_token: "id-token",
					refresh_token: "refresh-token",
					account_id: "acct-1",
				},
				last_refresh: "2026-01-01T00:00:00.000Z",
			})

			const auth = openaiCredentials({
				authFilePath: authPath,
				ensureFresh: false,
				fetch,
			})

			await expect(auth.getSession()).resolves.toEqual({
				accessToken: "access-token",
				accountId: "acct-1",
				isFedRamp: false,
				idToken: "id-token",
				refreshToken: "refresh-token",
				lastRefresh: "2026-01-01T00:00:00.000Z",
			})
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})
})
