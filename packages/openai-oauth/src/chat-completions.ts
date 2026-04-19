import { generateText } from "ai"
import type { OpenAIOAuthProvider } from "../../openai-oauth-provider/src/index.js"
import {
	createToolSet,
	toModelMessages,
	toToolChoice,
} from "./chat-messages.js"
import { streamChatCompletions } from "./chat-stream.js"
import { emitRequestLog } from "./logging.js"
import {
	isRecord,
	mapFinishReason,
	summarizeChatRequest,
	toErrorResponse,
	toJsonResponse,
	toUsage,
} from "./shared.js"
import type {
	ChatCompletionResultShape,
	ChatRequest,
	OpenAIOAuthServerLogEvent,
} from "./types.js"

const isChatRequest = (value: unknown): value is ChatRequest =>
	isRecord(value) &&
	(value.messages === undefined || Array.isArray(value.messages))

const toChatCompletionResponse = (
	result: ChatCompletionResultShape,
	request: ChatRequest,
): Response => {
	const toolCalls = result.toolCalls.map((toolCall) => ({
		id: toolCall.toolCallId,
		type: "function",
		function: {
			name: toolCall.toolName,
			arguments: JSON.stringify(toolCall.input),
		},
	}))

	return toJsonResponse({
		id: `chatcmpl_${crypto.randomUUID()}`,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: request.model,
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: result.text.length > 0 ? result.text : null,
					tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
				},
				finish_reason:
					toolCalls.length > 0 && mapFinishReason(result.finishReason) !== "tool_calls"
						? "tool_calls"
						: mapFinishReason(result.finishReason),
			},
		],
		usage: toUsage(result.usage),
	})
}

export const handleChatCompletionsRequest = async (
	request: Request,
	provider: OpenAIOAuthProvider,
	logger: ((event: OpenAIOAuthServerLogEvent) => void) | undefined,
): Promise<Response> => {
	const requestId = crypto.randomUUID()
	const startedAt = Date.now()
	const body = await request.json()

	if (!isChatRequest(body) || !Array.isArray(body.messages)) {
		emitRequestLog(logger, {
			type: "chat_error",
			requestId,
			path: "/v1/chat/completions",
			durationMs: Date.now() - startedAt,
			message: "`messages` must be an array.",
		})
		return toErrorResponse("`messages` must be an array.")
	}

	emitRequestLog(logger, {
		type: "chat_request",
		requestId,
		path: "/v1/chat/completions",
		...summarizeChatRequest(body),
	})

	if (body.stream === true) {
		return streamChatCompletions(body, provider, {
			logger,
			requestId,
			startedAt,
		})
	}

	try {
		const result = await generateText({
			model: provider(body.model ?? "gpt-5.2"),
			messages: toModelMessages(body.messages),
			tools: createToolSet(body.tools),
			toolChoice: toToolChoice(body.tool_choice),
			temperature: body.temperature,
			topP: body.top_p,
			stopSequences:
				typeof body.stop === "string"
					? [body.stop]
					: Array.isArray(body.stop)
						? body.stop
						: undefined,
			maxOutputTokens: body.max_tokens,
			providerOptions: {
				openai: {
					parallelToolCalls: body.parallel_tool_calls,
					reasoningEffort: body.reasoning_effort,
				},
			},
		})

		emitRequestLog(logger, {
			type: "chat_response",
			requestId,
			path: "/v1/chat/completions",
			status: 200,
			stream: false,
			durationMs: Date.now() - startedAt,
			finishReason: result.finishReason,
			usage: result.usage,
		})

		return toChatCompletionResponse(result, body)
	} catch (error) {
		emitRequestLog(logger, {
			type: "chat_error",
			requestId,
			path: "/v1/chat/completions",
			durationMs: Date.now() - startedAt,
			message:
				error instanceof Error ? error.message : "Unexpected server error.",
		})
		throw error
	}
}
