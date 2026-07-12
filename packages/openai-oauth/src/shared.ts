import { Buffer } from "node:buffer"
import type {
	IncomingHttpHeaders,
	IncomingMessage,
	ServerResponse,
} from "node:http"
import type { AddressInfo } from "node:net"
import type { ChatRequest, JsonValue, UsageLike } from "./types.js"

export const DEFAULT_HOST = "127.0.0.1"
export const DEFAULT_PORT = 10531

const jsonHeaders = {
	"content-type": "application/json; charset=utf-8",
}

export const sseHeaders = {
	"content-type": "text/event-stream; charset=utf-8",
	"cache-control": "no-cache, no-transform",
	connection: "keep-alive",
	"x-accel-buffering": "no",
}

export const corsHeaders = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET,POST,OPTIONS",
	"access-control-allow-headers": "authorization,content-type",
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

export const isJsonValue = (value: unknown): value is JsonValue => {
	if (
		value == null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return true
	}

	if (Array.isArray(value)) {
		return value.every((item) => isJsonValue(item))
	}

	if (isRecord(value)) {
		return Object.values(value).every((item) => isJsonValue(item))
	}

	return false
}

export const toJsonResponse = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: {
			...jsonHeaders,
			...corsHeaders,
		},
	})

export const toErrorResponse = (
	message: string,
	status = 400,
	type = "invalid_request_error",
): Response =>
	toJsonResponse(
		{
			error: {
				message,
				type,
			},
		},
		status,
	)

export const mapFinishReason = (
	finishReason: string | undefined,
): "stop" | "length" | "tool_calls" | "content_filter" | null => {
	switch (finishReason) {
		case "stop":
			return "stop"
		case "length":
			return "length"
		case "tool-calls":
			return "tool_calls"
		case "content-filter":
			return "content_filter"
		default:
			return null
	}
}

export const toUsage = (usage: UsageLike) => ({
	prompt_tokens: usage.inputTokens ?? 0,
	completion_tokens: usage.outputTokens ?? 0,
	total_tokens: usage.totalTokens ?? 0,
	prompt_tokens_details:
		usage.cachedInputTokens == null
			? undefined
			: {
					cached_tokens: usage.cachedInputTokens,
				},
	completion_tokens_details:
		usage.reasoningTokens == null
			? undefined
			: {
					reasoning_tokens: usage.reasoningTokens,
				},
})

export const summarizeChatRequest = (request: {
	model?: string
	messages?: Array<{ role?: string }>
	reasoning_effort?: ChatRequest["reasoning_effort"]
	stream?: boolean
	tools?: unknown[]
}) => ({
	bodyKeys: Object.keys(request).sort(),
	messageCount: request.messages?.length ?? 0,
	messageRoles: (request.messages ?? [])
		.map((message) => message.role)
		.filter((role): role is string => typeof role === "string"),
	model: request.model,
	reasoningEffort: request.reasoning_effort,
	stream: request.stream === true,
	toolCount: request.tools?.length ?? 0,
})

export const resolveModels = (
	models: string[] | undefined,
): string[] | undefined =>
	Array.isArray(models) && models.length > 0 ? [...models] : undefined

export const copyUpstreamResponse = (response: Response): Response => {
	const headers = new Headers(response.headers)
	headers.delete("content-encoding")
	headers.delete("content-length")
	for (const [key, value] of Object.entries(corsHeaders)) {
		headers.set(key, value)
	}

	if (!headers.has("content-type")) {
		headers.set("content-type", "application/json; charset=utf-8")
	}

	return new Response(response.body, {
		status: response.status,
		headers,
	})
}

export const readNodeBody = async (
	request: IncomingMessage,
): Promise<Uint8Array> => {
	const chunks: Buffer[] = []

	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
	}

	return Buffer.concat(chunks)
}

export const toHeaders = (headers: IncomingHttpHeaders): Headers => {
	const nextHeaders = new Headers()

	for (const [key, value] of Object.entries(headers)) {
		if (Array.isArray(value)) {
			for (const item of value) {
				nextHeaders.append(key, item)
			}
			continue
		}

		if (typeof value === "string") {
			nextHeaders.set(key, value)
		}
	}

	return nextHeaders
}

export const toWebRequest = async (
	request: IncomingMessage,
	options: { host: string; port: number },
): Promise<Request> => {
	const url = `http://${options.host}:${options.port}${request.url ?? "/"}`
	const body =
		request.method === "GET" || request.method === "HEAD"
			? undefined
			: await readNodeBody(request)

	return new Request(url, {
		method: request.method,
		headers: toHeaders(request.headers),
		body:
			body == null || body.byteLength === 0
				? undefined
				: new Blob([Buffer.from(body)]),
		duplex: "half",
	} as RequestInit)
}

export const writeWebResponse = async (
	response: ServerResponse,
	webResponse: Response,
): Promise<void> => {
	response.statusCode = webResponse.status
	webResponse.headers.forEach((value, key) => {
		response.setHeader(key, value)
	})

	if (webResponse.body == null) {
		response.end()
		return
	}

	const reader = webResponse.body.getReader()
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) {
				break
			}

			response.write(Buffer.from(value))
		}
	} finally {
		reader.releaseLock()
	}

	response.end()
}

export const resolveAddress = (
	address: AddressInfo,
	host: string,
): { host: string; port: number } => ({
	host:
		address.address === "::" || address.address === "0.0.0.0"
			? host
			: address.address,
	port: address.port,
})
