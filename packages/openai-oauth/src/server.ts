import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import {
	createOpenAIOAuth,
	type OpenAIOAuthProvider,
} from "@openai-oauth/ai-sdk"
import {
	createOpenAIOAuthTransport,
	type OpenAIOAuthTransport,
} from "@openai-oauth/core"
import { openaiCredentials } from "@openai-oauth/local"
import { handleChatCompletionsRequest } from "./chat-completions.js"
import {
	handleImageEditRequest,
	handleImageGenerationRequest,
} from "./images.js"
import { createRequestLogger } from "./logging.js"
import { createModelResolver } from "./models.js"
import { handleResponsesRequest } from "./responses.js"
import {
	DEFAULT_HOST,
	DEFAULT_PORT,
	resolveAddress,
	toErrorResponse,
	toJsonResponse,
	toWebRequest,
	writeWebResponse,
} from "./shared.js"
import type {
	OpenAIOAuthServerOptions,
	RunningOpenAIOAuthServer,
} from "./types.js"

const handleRoutes = async (
	request: Request,
	provider: OpenAIOAuthProvider,
	client: OpenAIOAuthTransport,
	resolveModels: () => Promise<string[]>,
	requestLogger: ReturnType<typeof createRequestLogger>,
): Promise<Response> => {
	const url = new URL(request.url)
	if (request.method === "GET" && url.pathname === "/health") {
		return toJsonResponse({
			ok: true,
			replay_state: "stateless",
		})
	}

	if (request.method === "GET" && url.pathname === "/v1/models") {
		try {
			const models = await resolveModels()
			return toJsonResponse({
				object: "list",
				data: models.map((id) => ({
					id,
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				})),
			})
		} catch (error) {
			return toErrorResponse(
				error instanceof Error ? error.message : "Failed to load models.",
				502,
				"upstream_error",
			)
		}
	}

	if (request.method === "POST" && url.pathname === "/v1/responses") {
		return handleResponsesRequest(request, client)
	}

	if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
		return handleChatCompletionsRequest(request, provider, requestLogger)
	}

	if (request.method === "POST" && url.pathname === "/v1/images/generations") {
		return handleImageGenerationRequest(request, client)
	}

	if (request.method === "POST" && url.pathname === "/v1/images/edits") {
		return handleImageEditRequest(request, client)
	}

	return toErrorResponse("Route not found.", 404, "not_found_error")
}

const createOpenAIOAuthRuntime = (settings: OpenAIOAuthServerOptions = {}) => {
	const auth = openaiCredentials(settings)
	const sharedSettings = {
		...settings,
		auth: () => auth.getSession(),
		responsesState: false as const,
	}
	const client = createOpenAIOAuthTransport(sharedSettings)
	const provider = createOpenAIOAuth(client)
	const resolveModels = createModelResolver(client, settings.models)
	const requestLogger = createRequestLogger(settings)

	const handler = async (request: Request): Promise<Response> => {
		try {
			return await handleRoutes(
				request,
				provider,
				client,
				resolveModels,
				requestLogger,
			)
		} catch (error) {
			return toErrorResponse(
				error instanceof Error ? error.message : "Unexpected server error.",
				500,
				"server_error",
			)
		}
	}

	return { handler, resolveModels }
}

export const createOpenAIOAuthFetchHandler = (
	settings: OpenAIOAuthServerOptions = {},
): ((request: Request) => Promise<Response>) =>
	createOpenAIOAuthRuntime(settings).handler

export const startOpenAIOAuthServer = async (
	settings: OpenAIOAuthServerOptions = {},
): Promise<RunningOpenAIOAuthServer> => {
	const host = settings.host ?? DEFAULT_HOST
	const port = settings.port ?? DEFAULT_PORT
	const runtime = createOpenAIOAuthRuntime(settings)
	const models = await runtime.resolveModels()
	const handler = runtime.handler
	const server = createServer(async (req, res) => {
		try {
			const request = await toWebRequest(req, { host, port })
			const response = await handler(request)
			await writeWebResponse(res, response)
		} catch (error) {
			if (res.headersSent || res.writableEnded) {
				res.destroy(error instanceof Error ? error : undefined)
				return
			}

			const message =
				error instanceof Error ? error.message : "Unexpected server error."
			await writeWebResponse(res, toErrorResponse(message, 500, "server_error"))
		}
	})

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(port, host, () => {
			server.off("error", reject)
			resolve()
		})
	})

	const address = resolveAddress(server.address() as AddressInfo, host)
	return {
		server,
		host: address.host,
		port: address.port,
		url: `http://${address.host}:${address.port}/v1`,
		models,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error)
						return
					}

					resolve()
				})
			}),
	}
}
