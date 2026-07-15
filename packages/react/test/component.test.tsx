// @vitest-environment happy-dom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, test, vi } from "vitest"
import { SignInWithChatGPT } from "../src/index.js"

describe("SignInWithChatGPT", () => {
	test("loads a stored session and disconnects it", async () => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
		const clear = vi.fn(async () => undefined)
		const sessionStore = {
			get: vi.fn(async () => ({ accessToken: "token", accountId: "account" })),
			set: vi.fn(async () => undefined),
			clear,
		}
		const container = document.createElement("div")
		const root = createRoot(container)

		await act(async () => {
			root.render(
				<SignInWithChatGPT hideAttribution sessionStore={sessionStore} />,
			)
		})
		expect(container.textContent).toContain("Disconnect ChatGPT")

		await act(async () => {
			container.querySelector("button")?.click()
		})
		expect(clear).toHaveBeenCalledOnce()
		expect(container.textContent).toContain("Sign in with ChatGPT")
		await act(async () => root.unmount())
	})

	test("reports session storage failures separately from callback failures", async () => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
		const onError = vi.fn()
		const container = document.createElement("div")
		const root = createRoot(container)

		await act(async () => {
			root.render(
				<SignInWithChatGPT
					hideAttribution
					onError={onError}
					sessionStore={{
						get: async () => {
							throw new Error("Stored session could not be decrypted.")
						},
						set: async () => undefined,
						clear: async () => undefined,
					}}
				/>,
			)
		})

		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ code: "request-failed" }),
		)
		await act(async () => root.unmount())
	})
})
