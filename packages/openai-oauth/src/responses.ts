import type { OpenAIOAuthTransport } from "@openai-oauth/core"
import { copyUpstreamResponse, isRecord, toErrorResponse } from "./shared.js"
import type { OpenAIOAuthResponsesStateMode } from "./types.js"

const usesServerReplayState = (body: Record<string, unknown>): boolean =>
	typeof body.previous_response_id === "string" ||
	(Array.isArray(body.input) &&
		body.input.some(
			(item) =>
				isRecord(item) &&
				item.type === "item_reference" &&
				typeof item.id === "string",
		))

export const handleResponsesRequest = async (
	request: Request,
	client: OpenAIOAuthTransport,
	responsesState: OpenAIOAuthResponsesStateMode,
): Promise<Response> => {
	let body: unknown
	try {
		body = await request.json()
	} catch {
		return toErrorResponse("Request body must be valid JSON.")
	}
	if (!isRecord(body)) {
		return toErrorResponse("Request body must be a JSON object.")
	}

	if (responsesState === "stateless" && usesServerReplayState(body)) {
		return toErrorResponse(
			"Stateless Codex responses endpoint does not support `previous_response_id` or `item_reference`. Replay the full conversation history in `input` on each request.",
		)
	}

	const upstream = await client.request("/responses", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal: request.signal,
	})
	return copyUpstreamResponse(upstream)
}
