import { afterEach, describe, expect, test } from "vitest"
import { startOpenAIOAuthServer } from "../src/index.js"

describe("node server runtime", () => {
	let close: (() => Promise<void>) | undefined

	afterEach(async () => {
		await close?.()
		close = undefined
	})

	test("starts an http server and serves health", async () => {
		const running = await startOpenAIOAuthServer({
			host: "127.0.0.1",
			port: 0,
			models: ["gpt-5.4-mini"],
		})
		close = running.close

		const response = await fetch(
			`http://${running.host}:${running.port}/health`,
		)
		expect(response.ok).toBe(true)
		await expect(response.json()).resolves.toEqual({
			ok: true,
			replay_state: "stateless",
		})
	})
})
