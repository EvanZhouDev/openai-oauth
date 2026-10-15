import { formatCost } from "./pricing.js"
import type {
	OpenAIOAuthServerLogEvent,
	OpenAIOAuthServerOptions,
} from "./types.js"

export const createRequestLogger = (
	settings: OpenAIOAuthServerOptions,
): ((event: OpenAIOAuthServerLogEvent) => void) | undefined => {
	if (typeof settings.requestLogger === "function") {
		return settings.requestLogger
	}

	if (process.env.CODEX_OPENAI_SERVER_LOG_REQUESTS !== "1") {
		return undefined
	}

	return (event) => {
		console.log(
			JSON.stringify({
				source: "openai-oauth",
				timestamp: new Date().toISOString(),
				...event,
			}),
		)
	}
}

export const emitRequestLog = (
	logger: ((event: OpenAIOAuthServerLogEvent) => void) | undefined,
	event: OpenAIOAuthServerLogEvent,
) => {
	try {
		logger?.(event)
	} catch {}
}

const ansi = {
	dim: "\u001B[2m",
	reset: "\u001B[0m",
	green: "\u001B[32m",
	yellow: "\u001B[33m",
	red: "\u001B[31m",
}

const withAnsi = (
	text: string,
	code: string,
	options?: { useColor?: boolean },
): string => {
	if (!options?.useColor) {
		return text
	}

	return `${code}${text}${ansi.reset}`
}

export type HttpRequestMeta = {
	model?: string
	stream?: boolean
	replayId?: string
	messageCount?: number
	prompt?: string
	target?: "local" | "openrouter"
}

export const extractRequestMeta = async (
	request: Request,
): Promise<HttpRequestMeta> => {
	if (request.method === "GET" || request.method === "HEAD") {
		return {}
	}
	try {
		const clone = request.clone()
		const body = (await clone.json()) as Record<string, unknown> | null
		if (typeof body !== "object" || body === null) {
			return {}
		}
		const meta: HttpRequestMeta = {}
		if (typeof body.model === "string") {
			meta.model = body.model
		}
		if (typeof body.stream === "boolean") {
			meta.stream = body.stream
		}
		if (typeof body.previous_response_id === "string") {
			meta.replayId = body.previous_response_id
		}
		if (Array.isArray(body.messages)) {
			meta.messageCount = body.messages.length
		}
		if (typeof body.prompt === "string") {
			meta.prompt =
				body.prompt.length > 40 ? `${body.prompt.slice(0, 37)}...` : body.prompt
		}
		return meta
	} catch {
		return {}
	}
}

const getStatusText = (status: number, statusText?: string): string => {
	if (statusText && statusText.length > 0) {
		return statusText
	}
	switch (status) {
		case 200:
			return "OK"
		case 201:
			return "Created"
		case 204:
			return "No Content"
		case 400:
			return "Bad Request"
		case 401:
			return "Unauthorized"
		case 403:
			return "Forbidden"
		case 404:
			return "Not Found"
		case 500:
			return "Internal Server Error"
		case 502:
			return "Bad Gateway"
		case 503:
			return "Service Unavailable"
		default:
			return ""
	}
}

export type HttpResponseMeta = {
	errorMessage?: string
	cachedTokens?: number
	isReplay?: boolean
	source?: "local" | "openrouter"
	cost?: number
}

export const formatIncomingLog = (
	method: string,
	pathname: string,
	meta: HttpRequestMeta,
	options?: { useColor?: boolean },
): string => {
	const timestamp = new Date().toTimeString().slice(0, 8)
	const details: string[] = []
	if (meta.model) {
		const modelStr =
			meta.target === "openrouter"
				? `${meta.model} -> OpenRouter fallback`
				: meta.model
		details.push(`model: ${modelStr}`)
	}
	if (meta.stream !== undefined) details.push(`stream: ${meta.stream}`)
	if (meta.replayId) details.push(`replay: ${meta.replayId}`)
	if (meta.messageCount !== undefined)
		details.push(`messages: ${meta.messageCount}`)
	if (meta.prompt) details.push(`prompt: "${meta.prompt}"`)
	const detailsStr = details.length > 0 ? ` (${details.join(", ")})` : ""

	const timePart = withAnsi(`[${timestamp}]`, ansi.dim, options)
	const arrowPart = withAnsi("-->", ansi.dim, options)
	return `${timePart} ${arrowPart} ${method} ${pathname}${detailsStr}`
}

export const formatCompletedLog = (
	method: string,
	pathname: string,
	status: number,
	statusText: string,
	durationMs: number,
	responseMeta?: HttpResponseMeta,
	options?: { useColor?: boolean },
): string => {
	const timestamp = new Date().toTimeString().slice(0, 8)
	const timePart = withAnsi(`[${timestamp}]`, ansi.dim, options)
	const arrowPart = withAnsi("<--", ansi.dim, options)
	const durationPart = withAnsi(
		`(${durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(2)}s`})`,
		ansi.dim,
		options,
	)

	let statusColor = ansi.reset
	if (status >= 200 && status < 300) {
		statusColor = ansi.green
	} else if (status >= 400 && status < 500) {
		statusColor = ansi.yellow
	} else if (status >= 500) {
		statusColor = ansi.red
	}

	const statusLabel = getStatusText(status, statusText)
	const statusFormatted = statusLabel ? `${status} ${statusLabel}` : `${status}`
	const statusStr = withAnsi(statusFormatted, statusColor, options)

	const tags: string[] = []
	if (responseMeta?.source === "openrouter") {
		tags.push("OpenRouter")
	}
	if (responseMeta?.isReplay) {
		tags.push("replay cache")
	}
	if (typeof responseMeta?.cachedTokens === "number") {
		if (responseMeta.cachedTokens > 0) {
			tags.push(`cached: ${responseMeta.cachedTokens.toLocaleString()} tokens`)
		} else {
			tags.push("cache: 0")
		}
	}
	if (typeof responseMeta?.cost === "number") {
		const costFormatted = formatCost(responseMeta.cost)
		const costTag =
			responseMeta.source === "local"
				? `cost: ${costFormatted} (saved)`
				: `cost: ${costFormatted}`
		tags.push(costTag)
	}
	const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : ""
	const errorSuffix = responseMeta?.errorMessage
		? ` - ${responseMeta.errorMessage}`
		: ""

	return `${timePart} ${arrowPart} ${method} ${pathname} ${statusStr} ${durationPart}${tagStr}${errorSuffix}`
}

export const extractErrorMessage = async (
	response: Response,
): Promise<string | undefined> => {
	if (response.status < 400) {
		return undefined
	}
	try {
		const clone = response.clone()
		const data = (await clone.json()) as {
			error?: { message?: string }
			message?: string
		} | null
		if (data && typeof data === "object") {
			if (
				data.error &&
				typeof data.error === "object" &&
				typeof data.error.message === "string"
			) {
				return data.error.message
			}
			if (typeof data.message === "string") {
				return data.message
			}
		}
	} catch {}
	return undefined
}

export const extractResponseMeta = async (
	response: Response,
	requestMeta?: HttpRequestMeta,
): Promise<HttpResponseMeta> => {
	const meta: HttpResponseMeta = {
		isReplay: Boolean(requestMeta?.replayId),
		source: requestMeta?.target === "openrouter" ? "openrouter" : "local",
	}

	if (response.status >= 400) {
		meta.errorMessage = await extractErrorMessage(response)
		return meta
	}

	const contentType = response.headers.get("content-type")
	if (contentType?.includes("application/json")) {
		try {
			const clone = response.clone()
			const data = (await clone.json()) as Record<string, unknown> | null
			if (data && typeof data === "object") {
				const usage = data.usage as Record<string, unknown> | undefined
				if (usage && typeof usage === "object") {
					const inputDetails = (usage.input_tokens_details ??
						usage.input_token_details) as Record<string, unknown> | undefined
					const promptDetails = (usage.prompt_tokens_details ??
						usage.prompt_token_details) as Record<string, unknown> | undefined
					const cached =
						inputDetails?.cached_tokens ??
						promptDetails?.cached_tokens ??
						usage.cached_tokens
					if (typeof cached === "number") {
						meta.cachedTokens = cached
					}
					if (typeof usage.cost === "number") {
						meta.cost = usage.cost
					}
				}
			}
		} catch {}
	}

	return meta
}

export type HttpAccessLogger = {
	logIncoming: (
		request: Request,
		precomputedMeta?: HttpRequestMeta,
	) => Promise<HttpRequestMeta>
	logCompleted: (
		request: Request,
		response: Response,
		durationMs: number,
		meta?: HttpRequestMeta,
		error?: unknown,
	) => Promise<void>
}

export const createHttpAccessLogger = (
	settings: OpenAIOAuthServerOptions,
): HttpAccessLogger | undefined => {
	const isVerbose =
		settings.verbose === true || process.env.OPENAI_OAUTH_VERBOSE === "1"

	if (!isVerbose) {
		return undefined
	}

	const write =
		settings.logWriter ??
		((message: string) => {
			console.log(message)
		})
	const useColor =
		Boolean(process.stdout?.isTTY) && process.env.NODE_DISABLE_COLORS !== "1"

	return {
		logIncoming: async (
			request: Request,
			precomputedMeta?: HttpRequestMeta,
		) => {
			const url = new URL(request.url)
			const meta = precomputedMeta ?? (await extractRequestMeta(request))
			write(formatIncomingLog(request.method, url.pathname, meta, { useColor }))
			return meta
		},
		logCompleted: async (
			request: Request,
			response: Response,
			durationMs: number,
			meta?: HttpRequestMeta,
			error?: unknown,
		) => {
			const url = new URL(request.url)
			const responseMeta = await extractResponseMeta(response, meta)
			if (error instanceof Error) {
				responseMeta.errorMessage = error.message
			}
			write(
				formatCompletedLog(
					request.method,
					url.pathname,
					response.status,
					response.statusText,
					durationMs,
					responseMeta,
					{ useColor },
				),
			)
		},
	}
}
