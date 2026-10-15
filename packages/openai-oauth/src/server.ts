import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import {
	createOpenAIOAuth,
	type OpenAIOAuthProvider,
} from "@openai-oauth/ai-sdk"
import {
	CodexResponsesState,
	createOpenAIOAuthTransport,
	type OpenAIOAuthTransport,
	type OpenAIOAuthTransportOptions,
} from "@openai-oauth/core"
import { openaiCredentials } from "@openai-oauth/local"
import { handleChatCompletionsRequest } from "./chat-completions.js"
import {
	handleImageEditRequest,
	handleImageGenerationRequest,
} from "./images.js"
import {
	createHttpAccessLogger,
	createRequestLogger,
	extractRequestMeta,
	type HttpRequestMeta,
} from "./logging.js"
import { createModelResolver } from "./models.js"
import {
	forwardToOpenRouter,
	isExternalProviderModel,
	matchModelRoute,
	type OpenRouterSettings,
	resolveOpenRouterApiKey,
} from "./openrouter.js"
import { injectUsageCost } from "./pricing.js"
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

const rewriteRequestBodyModel = async (
	request: Request,
	effectiveModel: string,
): Promise<Request> => {
	try {
		const clone = request.clone()
		const body = (await clone.json()) as Record<string, unknown> | null
		if (body && typeof body === "object" && body.model !== effectiveModel) {
			body.model = effectiveModel
			const headers = new Headers(request.headers)
			return new Request(request.url, {
				method: request.method,
				headers,
				body: JSON.stringify(body),
			})
		}
	} catch {}
	return request
}

const handleRoutes = async (
	request: Request,
	provider: OpenAIOAuthProvider,
	client: OpenAIOAuthTransport,
	resolveModels: () => Promise<string[]>,
	requestLogger: ReturnType<typeof createRequestLogger>,
	responsesState: CodexResponsesState | false,
	openrouterSettings?: OpenRouterSettings,
	requestMeta?: HttpRequestMeta,
): Promise<Response> => {
	const url = new URL(request.url)
	if (request.method === "GET" && url.pathname === "/health") {
		return toJsonResponse({
			ok: true,
			replay_state: responsesState === false ? "stateless" : "stateful",
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

	const hasOpenRouterKey = Boolean(
		resolveOpenRouterApiKey(
			request.headers.get("authorization"),
			openrouterSettings?.openrouterApiKey,
		),
	)

	if (request.method === "POST" && url.pathname === "/v1/responses") {
		let isLocal = true
		let effectiveModel = requestMeta?.model ?? "gpt-5.2"

		if (isExternalProviderModel(requestMeta?.model)) {
			isLocal = false
		} else if (hasOpenRouterKey) {
			const availableModels = await resolveModels().catch(() => [])
			const routeMatch = matchModelRoute(
				requestMeta?.model,
				availableModels,
				hasOpenRouterKey,
			)
			isLocal = routeMatch.isLocal
			effectiveModel = routeMatch.effectiveModel
		} else if (requestMeta?.model?.startsWith("openai/")) {
			effectiveModel = requestMeta.model.slice(7)
		}

		if (!isLocal) {
			if (requestMeta) requestMeta.target = "openrouter"
			const res = await forwardToOpenRouter(request, openrouterSettings)
			const { response: resWithCost } = await injectUsageCost(
				res,
				requestMeta?.model ?? effectiveModel,
			)
			return resWithCost
		}

		const effectiveRequest = await rewriteRequestBodyModel(
			request,
			effectiveModel,
		)
		const res = await handleResponsesRequest(
			effectiveRequest,
			client,
			responsesState,
		)
		const { response: resWithCost } = await injectUsageCost(res, effectiveModel)
		return resWithCost
	}

	if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
		let isLocal = true
		let effectiveModel = requestMeta?.model ?? "gpt-5.2"

		if (isExternalProviderModel(requestMeta?.model)) {
			isLocal = false
		} else if (hasOpenRouterKey) {
			const availableModels = await resolveModels().catch(() => [])
			const routeMatch = matchModelRoute(
				requestMeta?.model,
				availableModels,
				hasOpenRouterKey,
			)
			isLocal = routeMatch.isLocal
			effectiveModel = routeMatch.effectiveModel
		} else if (requestMeta?.model?.startsWith("openai/")) {
			effectiveModel = requestMeta.model.slice(7)
		}

		if (!isLocal) {
			if (requestMeta) requestMeta.target = "openrouter"
			const res = await forwardToOpenRouter(request, openrouterSettings)
			const { response: resWithCost } = await injectUsageCost(
				res,
				requestMeta?.model ?? effectiveModel,
			)
			return resWithCost
		}

		const effectiveRequest = await rewriteRequestBodyModel(
			request,
			effectiveModel,
		)
		const res = await handleChatCompletionsRequest(
			effectiveRequest,
			provider,
			requestLogger,
		)
		const { response: resWithCost } = await injectUsageCost(res, effectiveModel)
		return resWithCost
	}

	if (request.method === "POST" && url.pathname === "/v1/images/generations") {
		return handleImageGenerationRequest(request, client)
	}

	if (request.method === "POST" && url.pathname === "/v1/images/edits") {
		return handleImageEditRequest(request, client)
	}

	if (url.pathname.startsWith("/v1/")) {
		if (requestMeta) requestMeta.target = "openrouter"
		const res = await forwardToOpenRouter(request, openrouterSettings)
		if (requestMeta?.model) {
			const { response: resWithCost } = await injectUsageCost(
				res,
				requestMeta.model,
			)
			return resWithCost
		}
		return res
	}

	return toErrorResponse("Route not found.", 404, "not_found_error")
}

const createOpenAIOAuthRuntime = (settings: OpenAIOAuthServerOptions = {}) => {
	const auth = openaiCredentials(settings)
	const responsesState: CodexResponsesState | false =
		settings.responsesState === false
			? false
			: settings.responsesState instanceof CodexResponsesState
				? settings.responsesState
				: new CodexResponsesState()
	const sharedSettings: OpenAIOAuthTransportOptions = {
		...settings,
		auth: () => auth.getSession(),
		responsesState,
	}
	const client = createOpenAIOAuthTransport(sharedSettings)
	const provider = createOpenAIOAuth(client)
	const resolveModels = createModelResolver(client, settings.models)
	const requestLogger = createRequestLogger(settings)
	const httpLogger = createHttpAccessLogger(settings)

	const handler = async (request: Request): Promise<Response> => {
		const startedAt = Date.now()
		const meta = await extractRequestMeta(request)
		const hasOpenRouterKey = Boolean(
			resolveOpenRouterApiKey(
				request.headers.get("authorization"),
				settings.openrouterApiKey,
			),
		)
		if (isExternalProviderModel(meta.model)) {
			meta.target = "openrouter"
		} else if (hasOpenRouterKey) {
			const availableModels = await resolveModels().catch(() => [])
			const routeMatch = matchModelRoute(
				meta.model,
				availableModels,
				hasOpenRouterKey,
			)
			if (!routeMatch.isLocal) {
				meta.target = "openrouter"
			}
		}
		if (httpLogger) {
			await httpLogger.logIncoming(request, meta)
		}
		try {
			const response = await handleRoutes(
				request,
				provider,
				client,
				resolveModels,
				requestLogger,
				responsesState,
				{
					openrouterApiKey: settings.openrouterApiKey,
					openrouterBaseUrl: settings.openrouterBaseUrl,
				},
				meta,
			)
			if (httpLogger) {
				await httpLogger.logCompleted(
					request,
					response,
					Date.now() - startedAt,
					meta,
				)
			}
			return response
		} catch (error) {
			const response = toErrorResponse(
				error instanceof Error ? error.message : "Unexpected server error.",
				500,
				"server_error",
			)
			if (httpLogger) {
				await httpLogger.logCompleted(
					request,
					response,
					Date.now() - startedAt,
					meta,
					error,
				)
			}
			return response
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
