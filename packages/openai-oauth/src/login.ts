import { spawn } from "node:child_process"
import type { IncomingMessage, Server, ServerResponse } from "node:http"
import { createServer } from "node:http"
import { type AddressInfo, createConnection } from "node:net"
import {
	createOpenAIOAuthRequest,
	exchangeOpenAIOAuthCode,
	type SavedAuthTokens,
	saveAuthTokens,
} from "@openai-oauth/core"
import callbackSuccessHtml from "./callback-success.html?raw"

const DEFAULT_LOGIN_REDIRECT_HOST = "localhost"
const DEFAULT_LOGIN_PORT = 1455
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const LOOPBACK_LISTEN_HOSTS = ["::1", "127.0.0.1"] as const

const isAddressInUseError = (
	error: unknown,
): error is Error & { code: string } =>
	error instanceof Error &&
	"code" in error &&
	(error as { code?: unknown }).code === "EADDRINUSE"

const isAddressUnavailableError = (
	error: unknown,
): error is Error & { code: string } =>
	error instanceof Error &&
	"code" in error &&
	["EADDRNOTAVAIL", "EAFNOSUPPORT"].includes(
		String((error as { code?: unknown }).code),
	)

export type OpenAIOAuthLoginOptions = {
	host?: string
	redirectHost?: string
	clientId?: string
	tokenUrl?: string
	authFilePath?: string
	openBrowser?: boolean
	timeoutMs?: number
	fetch?: typeof fetch
	onMessage?: (message: string) => void
	signal?: AbortSignal
}

type CallbackResult = {
	code: string
}

type LoginServer = Server<typeof IncomingMessage, typeof ServerResponse>

const createLoginCancelledError = (): Error =>
	new Error("OpenAI OAuth login cancelled.")

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

const htmlHeaders = {
	"Content-Type": "text/html; charset=utf-8",
	Connection: "close",
} as const

const textHeaders = {
	"Content-Type": "text/plain; charset=utf-8",
	Connection: "close",
} as const

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

const toCallbackPortInUseMessage = (
	redirectHost: string,
	port: number,
): string =>
	`OpenAI OAuth login needs http://${redirectHost}:${port}/auth/callback, but port ${port} is already in use. Stop the process using that port and try again.`

const listen = (
	server: LoginServer,
	port: number,
	host: string,
): Promise<void> =>
	new Promise((resolve, reject) => {
		server.once("error", reject)
		const onListening = () => {
			server.off("error", reject)
			resolve()
		}
		server.listen(port, host, onListening)
	})

const closeServers = async (servers: LoginServer[]): Promise<void> => {
	await Promise.all(servers.map((server) => closeServer(server)))
}

const listenOnCallbackPort = async (
	handler: (req: IncomingMessage, res: ServerResponse) => void,
	port: number,
	host: string | undefined,
): Promise<LoginServer[]> => {
	if (host) {
		const server = createServer(handler)
		await listen(server, port, host)
		return [server]
	}

	const servers: LoginServer[] = []
	for (const loopbackHost of LOOPBACK_LISTEN_HOSTS) {
		const server = createServer(handler)
		try {
			await listen(server, port, loopbackHost)
			servers.push(server)
		} catch (error) {
			await closeServer(server)
			if (isAddressUnavailableError(error)) {
				continue
			}
			await closeServers(servers)
			throw error
		}
	}

	if (servers.length === 0) {
		throw new Error("No loopback address is available for OpenAI OAuth login.")
	}

	return servers
}

const closeServer = (server: LoginServer): Promise<void> =>
	new Promise((resolve, reject) => {
		if (!server.listening) {
			resolve()
			return
		}

		server.close((error) => {
			if (error) {
				reject(error)
				return
			}
			resolve()
		})
		server.closeIdleConnections?.()
	})

const isCallbackHostReachable = (
	host: string,
	port: number,
	timeoutMs = 100,
): Promise<boolean> =>
	new Promise((resolve) => {
		let settled = false
		const socket = createConnection({ host, port })
		const settle = (value: boolean) => {
			if (settled) {
				return
			}
			settled = true
			socket.destroy()
			resolve(value)
		}

		socket.setTimeout(timeoutMs)
		socket.once("connect", () => settle(true))
		socket.once("error", () => settle(false))
		socket.once("timeout", () => settle(false))
	})

export const runOpenAIOAuthLogin = async (
	options: OpenAIOAuthLoginOptions = {},
): Promise<SavedAuthTokens> => {
	if (options.signal?.aborted) {
		throw createLoginCancelledError()
	}

	const redirectHost = options.redirectHost ?? DEFAULT_LOGIN_REDIRECT_HOST
	const listenHost = options.host
	const callbackPort = DEFAULT_LOGIN_PORT
	const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS
	const onMessage = options.onMessage ?? console.log

	let expectedState = ""
	let redirectUri = ""
	let servers: LoginServer[] = []
	let settleCallback: ((result: CallbackResult) => void) | undefined
	let rejectCallback: ((error: Error) => void) | undefined
	let rejectAbort: ((error: Error) => void) | undefined

	const callbackPromise = new Promise<CallbackResult>((resolve, reject) => {
		settleCallback = resolve
		rejectCallback = reject
	})
	const abortPromise = new Promise<never>((_, reject) => {
		rejectAbort = reject
	})
	const abortLogin = () => {
		rejectAbort?.(createLoginCancelledError())
	}
	options.signal?.addEventListener("abort", abortLogin, { once: true })

	const handleCallbackRequest = (
		req: IncomingMessage,
		res: ServerResponse,
	): void => {
		const url = new URL(req.url ?? "/", redirectUri || `http://${redirectHost}`)
		if (url.pathname === "/cancel") {
			res.writeHead(200, textHeaders)
			res.end("Cancelled")
			rejectCallback?.(new Error("OpenAI OAuth login cancelled."))
			return
		}

		if (url.pathname !== "/auth/callback") {
			res.writeHead(404, textHeaders)
			res.end("Not found")
			return
		}

		const error = url.searchParams.get("error")
		if (error) {
			res.writeHead(400, htmlHeaders)
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
			res.writeHead(400, htmlHeaders)
			res.end(
				toCallbackHtml(
					"OpenAI OAuth login failed",
					"You can close this window and return to the terminal.",
				),
			)
			rejectCallback?.(new Error("OpenAI OAuth callback was invalid."))
			return
		}

		res.writeHead(200, htmlHeaders)
		res.end(callbackSuccessHtml)
		settleCallback?.({ code })
	}

	if (await isCallbackHostReachable(redirectHost, callbackPort)) {
		throw new Error(toCallbackPortInUseMessage(redirectHost, callbackPort))
	}

	try {
		servers = await listenOnCallbackPort(
			handleCallbackRequest,
			callbackPort,
			listenHost,
		)
		const address = servers[0]?.address() as AddressInfo | null
		if (address?.port !== callbackPort) {
			throw new Error("OpenAI OAuth login callback port could not be resolved.")
		}
	} catch (error) {
		if (isAddressInUseError(error)) {
			throw new Error(toCallbackPortInUseMessage(redirectHost, callbackPort))
		}
		throw error
	}

	try {
		redirectUri = `http://${redirectHost}:${callbackPort}/auth/callback`
		if (options.signal?.aborted) {
			throw createLoginCancelledError()
		}
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
		const callback = await Promise.race([
			callbackPromise,
			timeout,
			abortPromise,
		])
		const token = await exchangeOpenAIOAuthCode({
			code: callback.code,
			codeVerifier: request.codeVerifier,
			redirectUri,
			clientId: options.clientId,
			tokenUrl: options.tokenUrl,
			fetch: options.fetch,
			signal: options.signal,
		})
		const saved = await saveAuthTokens({
			token,
			authFilePath: options.authFilePath,
		})

		onMessage(`Credentials saved to ${saved.path}`)
		return saved
	} finally {
		options.signal?.removeEventListener("abort", abortLogin)
		await closeServers(servers)
	}
}
