import { handleChatCompletions } from "@/lib/gateway/chat-completions"
import {
	copyUpstreamResponse,
	createGatewayRuntime,
	errorResponse,
	isRecord,
	usesServerReplayState,
} from "@/lib/gateway/runtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

type RouteContext = {
	params: Promise<{ path?: string[] }>
}

const toEndpoint = async (context: RouteContext): Promise<string> =>
	((await context.params).path ?? []).join("/")

const toMessage = (error: unknown): string =>
	error instanceof Error ? error.message : "Unexpected gateway error."

/**
 * Credentials arrive per request from the signed-in browser, so a missing or
 * malformed header is an auth failure rather than a server fault.
 */
const isAuthError = (error: unknown): boolean =>
	error instanceof Error &&
	error.message.includes("OpenAI OAuth request headers")

/**
 * Errors raised by the AI SDK carry the upstream HTTP status. Forwarding it
 * keeps a rejected ChatGPT token a 401 instead of a generic 500.
 */
const toStatus = (error: unknown): number => {
	if (isAuthError(error)) {
		return 401
	}
	const status = (error as { statusCode?: unknown })?.statusCode
	return typeof status === "number" && status >= 400 && status <= 599
		? status
		: 500
}

const toErrorResponse = (error: unknown): Response => {
	const status = toStatus(error)
	return errorResponse(
		toMessage(error),
		status,
		status === 401 || status === 403
			? "authentication_error"
			: status >= 500
				? "upstream_error"
				: "invalid_request_error",
	)
}

export async function GET(
	request: Request,
	context: RouteContext,
): Promise<Response> {
	const endpoint = await toEndpoint(context)
	if (endpoint !== "models") {
		return errorResponse(
			`Unknown endpoint /v1/${endpoint}.`,
			404,
			"not_found_error",
		)
	}

	try {
		const { transport } = createGatewayRuntime(request)
		return copyUpstreamResponse(await transport.request("/v1/models"))
	} catch (error) {
		return toErrorResponse(error)
	}
}

export async function POST(
	request: Request,
	context: RouteContext,
): Promise<Response> {
	const endpoint = await toEndpoint(context)
	const knownEndpoints = [
		"responses",
		"chat/completions",
		"images/generations",
		"images/edits",
	]
	if (!knownEndpoints.includes(endpoint)) {
		return errorResponse(
			`Unknown endpoint /v1/${endpoint}.`,
			404,
			"not_found_error",
		)
	}

	try {
		const { provider, transport } = createGatewayRuntime(request)

		if (endpoint === "chat/completions") {
			return await handleChatCompletions(request, provider)
		}

		if (endpoint === "images/generations") {
			const body: unknown = await request.json()
			if (!isRecord(body)) {
				return errorResponse("Request body must be a JSON object.")
			}

			const upstream = await transport.request("/v1/images/generations", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: request.signal,
			})
			return copyUpstreamResponse(upstream)
		}

		if (endpoint === "images/edits") {
			if (
				!request.headers.get("content-type")?.includes("multipart/form-data")
			) {
				return errorResponse(
					"Image editing requires a multipart/form-data request body.",
				)
			}

			let formData: FormData
			try {
				formData = await request.formData()
			} catch {
				return errorResponse(
					"Image editing request contains invalid form data.",
				)
			}

			// No Content-Type header here: the transport's fetch pipeline
			// converts this FormData into Codex's JSON `images` field itself,
			// and setting one would fight the boundary it needs to parse it.
			const upstream = await transport.request("/v1/images/edits", {
				method: "POST",
				body: formData,
				signal: request.signal,
			})
			return copyUpstreamResponse(upstream)
		}

		{
			const body: unknown = await request.json()
			if (!isRecord(body)) {
				return errorResponse("Request body must be a JSON object.")
			}
			if (usesServerReplayState(body)) {
				return errorResponse(
					"This endpoint is stateless. Replay the full conversation in `input` instead of using `previous_response_id` or `item_reference`.",
				)
			}

			const upstream = await transport.request("/v1/responses", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: request.signal,
			})
			return copyUpstreamResponse(upstream)
		}
	} catch (error) {
		return toErrorResponse(error)
	}
}
