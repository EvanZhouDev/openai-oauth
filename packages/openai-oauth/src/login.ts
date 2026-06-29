import { spawn } from "node:child_process"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import {
	createOpenAIOAuthRequest,
	exchangeOpenAIOAuthCode,
	type SavedAuthTokens,
	saveAuthTokens,
} from "@openai-oauth/core"

const DEFAULT_LOGIN_HOST = "127.0.0.1"
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000

export type OpenAIOAuthLoginOptions = {
	host?: string
	port?: number
	clientId?: string
	tokenUrl?: string
	authFilePath?: string
	openBrowser?: boolean
	timeoutMs?: number
	fetch?: typeof fetch
	onMessage?: (message: string) => void
}

type CallbackResult = {
	code: string
}

const toCallbackHtml = (
	title: string,
	message: string,
): string => `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>${title}</title>
		<style>
			body {
				font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
				margin: 3rem;
				line-height: 1.5;
			}
		</style>
	</head>
	<body>
		<h1>${title}</h1>
		<p>${message}</p>
	</body>
</html>`

const openUrl = (url: string): void => {
	const platform = process.platform
	const command =
		platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open"
	const args = platform === "win32" ? ["/c", "start", '""', url] : [url]
	const child = spawn(command, args, {
		detached: true,
		stdio: "ignore",
	})
	child.on("error", () => undefined)
	child.unref()
}

export const runOpenAIOAuthLogin = async (
	options: OpenAIOAuthLoginOptions = {},
): Promise<SavedAuthTokens> => {
	const host = options.host ?? DEFAULT_LOGIN_HOST
	const port = options.port ?? 0
	const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS
	const onMessage = options.onMessage ?? console.log

	let expectedState = ""
	let redirectUri = ""
	let settleCallback: ((result: CallbackResult) => void) | undefined
	let rejectCallback: ((error: Error) => void) | undefined

	const callbackPromise = new Promise<CallbackResult>((resolve, reject) => {
		settleCallback = resolve
		rejectCallback = reject
	})

	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", redirectUri || `http://${host}`)
		if (url.pathname !== "/auth/callback") {
			res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
			res.end("Not found")
			return
		}

		const error = url.searchParams.get("error")
		if (error) {
			res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
			res.end(
				toCallbackHtml(
					"OpenAI OAuth login failed",
					"You can close this window and return to the terminal.",
				),
			)
			rejectCallback?.(new Error(`OpenAI OAuth login failed: ${error}`))
			return
		}

		const state = url.searchParams.get("state")
		const code = url.searchParams.get("code")
		if (!code || state !== expectedState) {
			res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
			res.end(
				toCallbackHtml(
					"OpenAI OAuth login failed",
					"You can close this window and return to the terminal.",
				),
			)
			rejectCallback?.(new Error("OpenAI OAuth callback was invalid."))
			return
		}

		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
		res.end(
			toCallbackHtml(
				"OpenAI OAuth login complete",
				"You can close this window and return to the terminal.",
			),
		)
		settleCallback?.({ code })
	})

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(port, host, () => {
			server.off("error", reject)
			resolve()
		})
	})

	try {
		const address = server.address() as AddressInfo
		redirectUri = `http://${host}:${address.port}/auth/callback`
		const request = await createOpenAIOAuthRequest({
			redirectUri,
			clientId: options.clientId,
		})
		expectedState = request.state

		onMessage(`OpenAI OAuth login URL: ${request.authorizationUrl}`)
		if (options.openBrowser !== false) {
			openUrl(request.authorizationUrl)
		}

		const timeout = new Promise<never>((_, reject) => {
			setTimeout(() => {
				reject(new Error("OpenAI OAuth login timed out."))
			}, timeoutMs).unref()
		})
		const callback = await Promise.race([callbackPromise, timeout])
		const token = await exchangeOpenAIOAuthCode({
			code: callback.code,
			codeVerifier: request.codeVerifier,
			redirectUri,
			clientId: options.clientId,
			tokenUrl: options.tokenUrl,
			fetch: options.fetch,
		})
		const saved = await saveAuthTokens({
			token,
			authFilePath: options.authFilePath,
		})

		onMessage(`OpenAI OAuth sessions saved to ${saved.path}`)
		return saved
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => {
				if (error) {
					reject(error)
					return
				}
				resolve()
			})
		})
	}
}
