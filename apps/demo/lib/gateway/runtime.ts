import {
	createOpenAIOAuth,
	type OpenAIOAuthProvider,
} from "@openai-oauth/ai-sdk"
import {
	createOpenAIOAuthTransport,
	type OpenAIOAuthTransport,
} from "@openai-oauth/core"
import { openaiCredentials } from "@openai-oauth/react/server"

export type GatewayRuntime = {
	provider: OpenAIOAuthProvider
	transport: OpenAIOAuthTransport
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The Codex upstream is stateless, so server-side replay references cannot be
 * resolved. Mirrors the same guard in the `openai-oauth` CLI proxy.
 */
export const usesServerReplayState = (body: Record<string, unknown>): boolean =>
	typeof body.previous_response_id === "string" ||
	(Array.isArray(body.input) &&
		body.input.some(
			(item) =>
				isRecord(item) &&
				item.type === "item_reference" &&
				typeof item.id === "string",
		))

export const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	})

export const errorResponse = (
	message: string,
	status = 400,
	type = "invalid_request_error",
): Response => jsonResponse({ error: { message, type } }, status)

export const copyUpstreamResponse = (response: Response): Response => {
	const headers = new Headers(response.headers)
	headers.delete("content-encoding")
	headers.delete("content-length")
	if (!headers.has("content-type")) {
		headers.set("content-type", "application/json; charset=utf-8")
	}

	return new Response(response.body, {
		status: response.status,
		headers,
	})
}

/**
 * Builds a per-request runtime from the browser session that
 * `openaiAuthHeaders()` attached to the incoming request. Nothing is cached
 * across requests, so one user's ChatGPT credentials never reach another's
 * call.
 */
export const createGatewayRuntime = (request: Request): GatewayRuntime => {
	const credentials = openaiCredentials(request)
	const transport = createOpenAIOAuthTransport({
		auth: () => credentials.getSession(),
		responsesState: false,
	})

	return {
		transport,
		provider: createOpenAIOAuth(transport),
	}
}
