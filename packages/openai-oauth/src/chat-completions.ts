import { generateObject, generateText, jsonSchema } from "ai"
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

type ChatCompletionDeps = {
	generateTextFn?: typeof generateText
	generateObjectFn?: typeof generateObject
}

const isChatRequest = (value: unknown): value is ChatRequest =>
	isRecord(value) &&
	(value.messages === undefined || Array.isArray(value.messages))

const toStructuredSchema = (
	request: ChatRequest,
): {
	schema: ReturnType<typeof jsonSchema>
	name?: string
	description?: string
} | undefined => {
	const responseFormat = request.response_format
	if (
		responseFormat?.type !== "json_schema" ||
		responseFormat.json_schema?.schema == null
	) {
		return undefined
	}

	return {
		schema: jsonSchema(responseFormat.json_schema.schema),
		name: responseFormat.json_schema.name,
		description: responseFormat.json_schema.description,
	}
}

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
				finish_reason: mapFinishReason(result.finishReason),
			},
		],
		usage: toUsage(result.usage),
	})
}

export const handleChatCompletionsRequest = async (
	request: Request,
	provider: OpenAIOAuthProvider,
	logger: ((event: OpenAIOAuthServerLogEvent) => void) | undefined,
	deps: ChatCompletionDeps = {},
): Promise<Response> => {
	const generateTextFn = deps.generateTextFn ?? generateText
	const generateObjectFn = deps.generateObjectFn ?? generateObject
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
		const structuredSchema = toStructuredSchema(body)
		const result: ChatCompletionResultShape =
			structuredSchema != null
				? await generateObjectFn({
						model: provider(body.model ?? "gpt-5.2"),
						messages: toModelMessages(body.messages),
						temperature: body.temperature,
						topP: body.top_p,
						maxOutputTokens: body.max_tokens,
						schema: structuredSchema.schema,
						schemaName: structuredSchema.name,
						schemaDescription: structuredSchema.description,
						providerOptions: {
							openai: {
								reasoningEffort: body.reasoning_effort,
							},
						},
				  }).then((structuredResult) => ({
						text: JSON.stringify(structuredResult.object),
						finishReason: structuredResult.finishReason,
						toolCalls: [],
						usage: structuredResult.usage,
				  }))
				: await generateTextFn({
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
