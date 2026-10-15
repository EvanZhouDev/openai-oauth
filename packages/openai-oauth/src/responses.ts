import type {
	CodexResponsesState,
	OpenAIOAuthTransport,
} from "@openai-oauth/core"
import { copyUpstreamResponse, isRecord, toErrorResponse } from "./shared.js"

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
	responsesState?: CodexResponsesState | false,
): Promise<Response> => {
	const body = await request.json()
	if (!isRecord(body)) {
		return toErrorResponse("Request body must be a JSON object.")
	}

	if (responsesState === false && usesServerReplayState(body)) {
		return toErrorResponse(
			"Stateless Codex responses endpoint does not support `previous_response_id` or `item_reference`. Replay the full conversation history in `input` on each request.",
		)
	}

	if (responsesState) {
		if (responsesState.requiresCachedState(body)) {
			await responsesState.waitForPendingCaptures()
		}

		if (
			typeof body.previous_response_id === "string" &&
			!responsesState.hasResponse(body.previous_response_id)
		) {
			return toErrorResponse(
				`Previous response ID "${body.previous_response_id}" was not found in conversation cache.`,
				400,
				"invalid_request_error",
			)
		}

		if (Array.isArray(body.input)) {
			for (const item of body.input) {
				if (
					isRecord(item) &&
					item.type === "item_reference" &&
					typeof item.id === "string" &&
					!responsesState.hasItem(item.id)
				) {
					return toErrorResponse(
						`Referenced item "${item.id}" was not found in conversation cache.`,
						400,
						"invalid_request_error",
					)
				}
			}
		}
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
