import {
	query,
	type SDKResultMessage,
	type SDKResultSuccess,
} from "@anthropic-ai/claude-agent-sdk"
import { emitRequestLog } from "./logging.js"
import {
	isRecord,
	sseHeaders,
	toErrorResponse,
	toJsonResponse,
	toUsage,
} from "./shared.js"
import type {
	ChatMessage,
	ChatRequest,
	OpenAIOAuthServerLogEvent,
	UsageLike,
} from "./types.js"
import { packageVersion } from "./version.js"

export const CLAUDE_MODELS = [
	"claude-sonnet",
	"claude-opus",
	"claude-haiku",
] as const

const modelAliases: Record<string, string> = {
	"claude-sonnet": "sonnet",
	"claude-opus": "opus",
	"claude-haiku": "haiku",
}

export const isClaudeModel = (model: string | undefined): boolean =>
	model?.startsWith("claude-") === true

const toSubscriptionEnvironment = (): Record<string, string | undefined> => {
	const env = { ...process.env }
	for (const name of [
		"ANTHROPIC_API_KEY",
		"ANTHROPIC_AUTH_TOKEN",
		"CLAUDE_CODE_USE_BEDROCK",
		"CLAUDE_CODE_USE_VERTEX",
		"CLAUDE_CODE_USE_FOUNDRY",
	]) {
		delete env[name]
	}
	env.CLAUDE_AGENT_SDK_CLIENT_APP = `openai-oauth/${packageVersion}`
	return env
}

const toText = (content: unknown): string => {
	if (content == null) {
		return ""
	}
	if (typeof content === "string") {
		return content
	}
	if (
		Array.isArray(content) &&
		content.every(
			(part) =>
				typeof part === "string" ||
				(isRecord(part) && typeof part.text === "string"),
		)
	) {
		return content
			.map((part) => (typeof part === "string" ? part : part.text))
			.join("")
	}
	throw new Error("Claude currently supports text message content only.")
}

const toClaudeInput = (messages: ChatMessage[]) => {
	const system: string[] = []
	const conversation: Array<{ role: string; content: string }> = []

	for (const message of messages) {
		if (message.tool_calls?.length || message.role === "tool") {
			throw new Error("Claude tool calls are not supported.")
		}
		const content = toText(message.content)
		if (message.role === "system" || message.role === "developer") {
			system.push(content)
		} else {
			conversation.push({
				role: message.role === "assistant" ? "assistant" : "user",
				content,
			})
		}
	}

	return {
		systemPrompt: [
			...system,
			"Continue the JSON conversation supplied by the user and reply only as the assistant.",
		].join("\n\n"),
		prompt: JSON.stringify(conversation),
	}
}

const toClaudeUsage = (result: SDKResultMessage): UsageLike => ({
	inputTokens: result.usage.input_tokens,
	outputTokens: result.usage.output_tokens,
	totalTokens: result.usage.input_tokens + result.usage.output_tokens,
	cachedInputTokens: result.usage.cache_read_input_tokens,
})

const toFinishReason = (result: SDKResultSuccess): "stop" | "length" =>
	result.stop_reason === "max_tokens" ? "length" : "stop"

const toClaudeError = (result: Exclude<SDKResultMessage, SDKResultSuccess>) =>
	new Error(
		result.errors.join("\n") ||
			"Claude request failed. Run `claude` and sign in to your subscription.",
	)

const createClaudeQuery = (
	request: ChatRequest,
	signal: AbortSignal,
	stream: boolean,
) => {
	const abortController = new AbortController()
	const abort = () => abortController.abort()
	if (signal.aborted) {
		abort()
	} else {
		signal.addEventListener("abort", abort, { once: true })
	}
	const input = toClaudeInput(request.messages ?? [])

	return {
		messages: query({
			prompt: input.prompt,
			options: {
				abortController,
				env: toSubscriptionEnvironment(),
				includePartialMessages: stream,
				maxTurns: 1,
				model: modelAliases[request.model ?? ""] ?? request.model,
				persistSession: false,
				settingSources: [],
				systemPrompt: input.systemPrompt,
				tools: [],
			},
		}),
		dispose: () => signal.removeEventListener("abort", abort),
	}
}

type LogContext = {
	logger?: (event: OpenAIOAuthServerLogEvent) => void
	requestId: string
	startedAt: number
}

const logError = (context: LogContext, error: unknown) => {
	emitRequestLog(context.logger, {
		type: "chat_error",
		requestId: context.requestId,
		path: "/v1/chat/completions",
		durationMs: Date.now() - context.startedAt,
		message: error instanceof Error ? error.message : "Claude request failed.",
	})
}

const encodeSse = (data: unknown): Uint8Array =>
	new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)

const streamClaudeChatCompletion = (
	request: ChatRequest,
	signal: AbortSignal,
	context: LogContext,
): Response => {
	const id = `chatcmpl_${crypto.randomUUID()}`
	const created = Math.floor(Date.now() / 1000)
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const claude = createClaudeQuery(request, signal, true)
			try {
				controller.enqueue(
					encodeSse({
						id,
						object: "chat.completion.chunk",
						created,
						model: request.model,
						choices: [
							{
								index: 0,
								delta: { role: "assistant" },
								finish_reason: null,
							},
						],
					}),
				)

				let finalResult: SDKResultMessage | undefined
				for await (const message of claude.messages) {
					if (
						message.type === "stream_event" &&
						message.event.type === "content_block_delta" &&
						message.event.delta.type === "text_delta"
					) {
						controller.enqueue(
							encodeSse({
								id,
								object: "chat.completion.chunk",
								created,
								model: request.model,
								choices: [
									{
										index: 0,
										delta: { content: message.event.delta.text },
										finish_reason: null,
									},
								],
							}),
						)
					} else if (message.type === "result") {
						finalResult = message
					}
				}

				if (!finalResult) {
					throw new Error("Claude returned no result.")
				}
				if (finalResult.subtype !== "success") {
					throw toClaudeError(finalResult)
				}

				const finishReason = toFinishReason(finalResult)
				const usage = toClaudeUsage(finalResult)
				emitRequestLog(context.logger, {
					type: "chat_response",
					requestId: context.requestId,
					path: "/v1/chat/completions",
					status: 200,
					stream: true,
					durationMs: Date.now() - context.startedAt,
					finishReason,
					usage,
				})
				controller.enqueue(
					encodeSse({
						id,
						object: "chat.completion.chunk",
						created,
						model: request.model,
						choices: [
							{
								index: 0,
								delta: {},
								finish_reason: finishReason,
							},
						],
					}),
				)
				controller.enqueue(
					encodeSse({
						id,
						object: "chat.completion.chunk",
						created,
						model: request.model,
						choices: [],
						usage: toUsage(usage),
					}),
				)
				controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
				controller.close()
			} catch (error) {
				logError(context, error)
				controller.error(error)
			} finally {
				claude.dispose()
			}
		},
	})

	return new Response(stream, { status: 200, headers: sseHeaders })
}

export const handleClaudeChatCompletionsRequest = async (
	request: ChatRequest,
	signal: AbortSignal,
	context: LogContext,
): Promise<Response> => {
	if (request.tools?.length) {
		const message = "Claude tools are not supported."
		logError(context, new Error(message))
		return toErrorResponse(message)
	}
	if (request.stream) {
		return streamClaudeChatCompletion(request, signal, context)
	}

	let claude: ReturnType<typeof createClaudeQuery>
	try {
		claude = createClaudeQuery(request, signal, false)
	} catch (error) {
		logError(context, error)
		return toErrorResponse(
			error instanceof Error ? error.message : "Invalid Claude request.",
		)
	}

	try {
		let finalResult: SDKResultMessage | undefined
		for await (const message of claude.messages) {
			if (message.type === "result") {
				finalResult = message
			}
		}
		if (!finalResult) {
			throw new Error("Claude returned no result.")
		}
		if (finalResult.subtype !== "success") {
			throw toClaudeError(finalResult)
		}

		const finishReason = toFinishReason(finalResult)
		const usage = toClaudeUsage(finalResult)
		emitRequestLog(context.logger, {
			type: "chat_response",
			requestId: context.requestId,
			path: "/v1/chat/completions",
			status: 200,
			stream: false,
			durationMs: Date.now() - context.startedAt,
			finishReason,
			usage,
		})
		return toJsonResponse({
			id: `chatcmpl_${crypto.randomUUID()}`,
			object: "chat.completion",
			created: Math.floor(Date.now() / 1000),
			model: request.model,
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: finalResult.result },
					finish_reason: finishReason,
				},
			],
			usage: toUsage(usage),
		})
	} catch (error) {
		logError(context, error)
		return toErrorResponse(
			error instanceof Error ? error.message : "Claude request failed.",
			502,
			"upstream_error",
		)
	} finally {
		claude.dispose()
	}
}
