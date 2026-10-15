import { copyUpstreamResponse, toErrorResponse } from "./shared.js"

export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

export type OpenRouterSettings = {
	openrouterApiKey?: string
	openrouterBaseUrl?: string
}

export const isDummyApiKey = (key: string | undefined | null): boolean => {
	if (!key) return true
	const cleaned = key
		.trim()
		.toLowerCase()
		.replace(/^bearer\s+/i, "")
	return (
		cleaned === "" ||
		cleaned === "dummy" ||
		cleaned === "none" ||
		cleaned === "test" ||
		cleaned === "placeholder" ||
		cleaned === "not-needed" ||
		cleaned === "null" ||
		cleaned === "undefined"
	)
}

export const resolveOpenRouterApiKey = (
	authHeader: string | null | undefined,
	configuredKey?: string,
): string | undefined => {
	if (authHeader && !isDummyApiKey(authHeader)) {
		return authHeader.startsWith("Bearer ") || authHeader.startsWith("bearer ")
			? authHeader
			: `Bearer ${authHeader}`
	}
	const fallback = configuredKey || process.env.OPENROUTER_API_KEY
	if (fallback && !isDummyApiKey(fallback)) {
		return fallback.startsWith("Bearer ") || fallback.startsWith("bearer ")
			? fallback
			: `Bearer ${fallback}`
	}
	return undefined
}

export type ModelRouteMatch = {
	isLocal: boolean
	effectiveModel: string
}

export const isExternalProviderModel = (model: string | undefined): boolean => {
	if (!model) return false
	return model.includes("/") && !model.startsWith("openai/")
}

export const matchModelRoute = (
	requestedModel: string | undefined,
	availableModels: string[],
	hasOpenRouterKey = false,
): ModelRouteMatch => {
	if (!requestedModel) {
		return { isLocal: true, effectiveModel: "gpt-5.2" }
	}
	if (isExternalProviderModel(requestedModel)) {
		return { isLocal: false, effectiveModel: requestedModel }
	}
	if (availableModels.includes(requestedModel)) {
		return { isLocal: true, effectiveModel: requestedModel }
	}
	if (requestedModel.startsWith("openai/")) {
		const stripped = requestedModel.slice(7)
		if (availableModels.includes(stripped)) {
			return { isLocal: true, effectiveModel: stripped }
		}
		if (availableModels.length === 0 || !hasOpenRouterKey) {
			return { isLocal: true, effectiveModel: stripped }
		}
		return { isLocal: false, effectiveModel: requestedModel }
	}
	if (availableModels.length === 0 || !hasOpenRouterKey) {
		return { isLocal: true, effectiveModel: requestedModel }
	}
	return { isLocal: false, effectiveModel: requestedModel }
}

export const forwardToOpenRouter = async (
	request: Request,
	options: OpenRouterSettings = {},
): Promise<Response> => {
	const authHeader = resolveOpenRouterApiKey(
		request.headers.get("authorization"),
		options.openrouterApiKey,
	)
	if (!authHeader) {
		return toErrorResponse(
			"The requested model is not available in local OpenAI OAuth, and no valid OpenRouter API key was provided. Pass your OpenRouter key in the Authorization header or set OPENROUTER_API_KEY.",
			401,
			"unauthorized",
		)
	}

	const url = new URL(request.url)
	const baseUrl = (
		options.openrouterBaseUrl ||
		process.env.OPENROUTER_BASE_URL ||
		DEFAULT_OPENROUTER_BASE_URL
	).replace(/\/+$/, "")

	const targetPath = url.pathname.replace(/^\/v1/, "")
	const targetUrl = `${baseUrl}${targetPath}${url.search}`

	const headers = new Headers()
	request.headers.forEach((value, key) => {
		const lower = key.toLowerCase()
		if (lower !== "host" && lower !== "content-length") {
			headers.set(key, value)
		}
	})
	headers.set("Authorization", authHeader)

	const body =
		request.method === "GET" || request.method === "HEAD"
			? undefined
			: await request.clone().arrayBuffer()

	const response = await fetch(targetUrl, {
		method: request.method,
		headers,
		body,
	})

	return copyUpstreamResponse(response)
}
