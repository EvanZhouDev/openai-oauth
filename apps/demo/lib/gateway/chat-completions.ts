import type { OpenAIOAuthProvider } from "@openai-oauth/ai-sdk"
import {
	generateText,
	jsonSchema,
	type ModelMessage,
	streamText,
	tool,
} from "ai"
import { errorResponse, isRecord } from "./runtime"

const DEFAULT_MODEL = "gpt-5.2"

export type ChatToolDefinition = {
	type?: string
	function?: {
		name?: string
		description?: string
		parameters?: Record<string, unknown>
	}
}

export type ChatToolChoice =
	| "auto"
	| "none"
	| "required"
	| { type?: string; function?: { name?: string } }

export type ChatMessage = {
	role?: string
	content?: unknown
	tool_calls?: Array<{
		id?: string
		function?: { name?: string; arguments?: string }
	}>
	tool_call_id?: string
}

export type ChatRequest = {
	model?: string
	messages?: ChatMessage[]
	stream?: boolean
	temperature?: number
	top_p?: number
	stop?: string | string[]
	max_tokens?: number
	parallel_tool_calls?: boolean
	reasoning_effort?: string
	tools?: ChatToolDefinition[]
	tool_choice?: ChatToolChoice
}

const sseHeaders = {
	"content-type": "text/event-stream; charset=utf-8",
	"cache-control": "no-cache, no-transform",
	connection: "keep-alive",
	"x-accel-buffering": "no",
}

const encodeSse = (data: unknown): Uint8Array =>
	new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)

const encodeDone = (): Uint8Array =>
	new TextEncoder().encode("data: [DONE]\n\n")

const mapFinishReason = (
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

/**
 * The AI SDK has reported token counts both as flat numbers and as
 * `{ total }` records across versions, so read either shape.
 */
const toTokenCount = (value: unknown): number | undefined => {
	if (typeof value === "number") {
		return value
	}
	if (isRecord(value) && typeof value.total === "number") {
		return value.total
	}
	return undefined
}

const toUsage = (usage: unknown) => {
	const source = isRecord(usage) ? usage : {}
	const inputTokens = toTokenCount(source.inputTokens)
	const outputTokens = toTokenCount(source.outputTokens)
	const cachedInputTokens = toTokenCount(source.cachedInputTokens)
	const reasoningTokens =
		toTokenCount(source.reasoningTokens) ??
		(isRecord(source.outputTokens)
			? toTokenCount(source.outputTokens.reasoning)
			: undefined)

	return {
		prompt_tokens: inputTokens ?? 0,
		completion_tokens: outputTokens ?? 0,
		total_tokens:
			toTokenCount(source.totalTokens) ??
			(inputTokens ?? 0) + (outputTokens ?? 0),
		prompt_tokens_details:
			cachedInputTokens == null
				? undefined
				: { cached_tokens: cachedInputTokens },
		completion_tokens_details:
			reasoningTokens == null
				? undefined
				: { reasoning_tokens: reasoningTokens },
	}
}

const parseToolArguments = (value: string | undefined): unknown => {
	if (typeof value !== "string" || value.length === 0) {
		return {}
	}
	try {
		return JSON.parse(value)
	} catch {
		return value
	}
}

const toTextParts = (content: unknown): string => {
	if (typeof content === "string") {
		return content
	}
	if (!Array.isArray(content)) {
		return ""
	}

	return content
		.map((item) =>
			isRecord(item) && item.type === "text" && typeof item.text === "string"
				? item.text
				: "",
		)
		.filter((item) => item.length > 0)
		.join("")
}

const toUserContent = (content: unknown) => {
	if (typeof content === "string") {
		return content
	}
	if (!Array.isArray(content)) {
		return ""
	}

	const parts: Array<
		{ type: "text"; text: string } | { type: "image"; image: URL }
	> = []

	for (const item of content) {
		if (!isRecord(item) || typeof item.type !== "string") {
			continue
		}
		if (item.type === "text" && typeof item.text === "string") {
			parts.push({ type: "text", text: item.text })
			continue
		}
		if (
			item.type === "image_url" &&
			isRecord(item.image_url) &&
			typeof item.image_url.url === "string"
		) {
			try {
				parts.push({ type: "image", image: new URL(item.image_url.url) })
			} catch {}
		}
	}

	return parts.length > 0 ? parts : ""
}

const toModelMessages = (messages: ChatMessage[]): ModelMessage[] => {
	const modelMessages: ModelMessage[] = []
	const toolNamesById = new Map<string, string>()

	for (const message of messages) {
		switch (message.role) {
			case "system":
			case "developer":
				modelMessages.push({
					role: "system",
					content: toTextParts(message.content),
				})
				break
			case "user":
				modelMessages.push({
					role: "user",
					content: toUserContent(message.content),
				})
				break
			case "assistant": {
				const parts: Array<
					| { type: "text"; text: string }
					| {
							type: "tool-call"
							toolCallId: string
							toolName: string
							input: unknown
					  }
				> = []

				const text = toTextParts(message.content)
				if (text.length > 0) {
					parts.push({ type: "text", text })
				}

				for (const toolCall of message.tool_calls ?? []) {
					const toolCallId = toolCall.id
					const toolName = toolCall.function?.name
					if (
						typeof toolCallId !== "string" ||
						typeof toolName !== "string" ||
						toolName.length === 0
					) {
						continue
					}

					toolNamesById.set(toolCallId, toolName)
					parts.push({
						type: "tool-call",
						toolCallId,
						toolName,
						input: parseToolArguments(toolCall.function?.arguments),
					})
				}

				modelMessages.push({
					role: "assistant",
					content:
						parts.length === 1 && parts[0]?.type === "text"
							? parts[0].text
							: parts,
				})
				break
			}
			case "tool": {
				if (typeof message.tool_call_id !== "string") {
					break
				}

				const raw = message.content
				const output =
					typeof raw === "string"
						? ({ type: "text", value: raw } as const)
						: ({ type: "json", value: raw as never } as const)

				modelMessages.push({
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: message.tool_call_id,
							toolName: toolNamesById.get(message.tool_call_id) ?? "tool",
							output,
						},
					],
				})
				break
			}
		}
	}

	return modelMessages
}

const createToolSet = (tools: ChatToolDefinition[] | undefined) => {
	if (!Array.isArray(tools) || tools.length === 0) {
		return undefined
	}

	const entries: Array<[string, ReturnType<typeof tool>]> = []
	for (const definition of tools) {
		const toolName = definition.function?.name
		if (
			definition.type !== "function" ||
			typeof toolName !== "string" ||
			toolName.length === 0
		) {
			continue
		}

		entries.push([
			toolName,
			tool({
				description: definition.function?.description,
				inputSchema: jsonSchema(
					definition.function?.parameters ?? {
						type: "object",
						properties: {},
						additionalProperties: true,
					},
				),
			}),
		])
	}

	return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

const toToolChoice = (
	toolChoice: ChatToolChoice | undefined,
):
	| undefined
	| "auto"
	| "none"
	| "required"
	| { type: "tool"; toolName: string } => {
	if (
		toolChoice == null ||
		toolChoice === "auto" ||
		toolChoice === "none" ||
		toolChoice === "required"
	) {
		return toolChoice
	}

	if (
		toolChoice.type === "function" &&
		typeof toolChoice.function?.name === "string"
	) {
		return { type: "tool", toolName: toolChoice.function.name }
	}

	return "auto"
}

const toStopSequences = (stop: ChatRequest["stop"]): string[] | undefined => {
	if (typeof stop === "string") {
		return [stop]
	}
	return Array.isArray(stop) ? stop : undefined
}

const toCallOptions = (
	request: ChatRequest,
	provider: OpenAIOAuthProvider,
) => ({
	model: provider(request.model ?? DEFAULT_MODEL),
	messages: toModelMessages(request.messages ?? []),
	tools: createToolSet(request.tools),
	toolChoice: toToolChoice(request.tool_choice),
	temperature: request.temperature,
	topP: request.top_p,
	stopSequences: toStopSequences(request.stop),
	maxOutputTokens: request.max_tokens,
	providerOptions: {
		openai: {
			parallelToolCalls: request.parallel_tool_calls,
			reasoningEffort: request.reasoning_effort,
			// Codex only emits reasoning summaries when they are asked for, and
			// the playground surfaces them as `reasoning_content` deltas.
			reasoningSummary: "auto",
		},
	},
})

const streamChatCompletions = (
	request: ChatRequest,
	provider: OpenAIOAuthProvider,
): Response => {
	const toolIndexes = new Map<string, number>()
	const toolsWithDeltas = new Set<string>()
	const created = Math.floor(Date.now() / 1000)
	const id = `chatcmpl_${crypto.randomUUID()}`
	const model = request.model ?? DEFAULT_MODEL
	const result = streamText(toCallOptions(request, provider))

	const chunk = (choices: unknown[], usage?: unknown) =>
		encodeSse({
			id,
			object: "chat.completion.chunk",
			created,
			model,
			choices,
			...(usage === undefined ? {} : { usage }),
		})

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			controller.enqueue(
				chunk([
					{ index: 0, delta: { role: "assistant" }, finish_reason: null },
				]),
			)

			try {
				for await (const part of result.fullStream) {
					switch (part.type) {
						case "text-delta":
							controller.enqueue(
								chunk([
									{
										index: 0,
										delta: { content: part.text },
										finish_reason: null,
									},
								]),
							)
							break
						case "reasoning-delta":
							// Not part of the OpenAI schema. `reasoning_content` is the
							// field name OpenAI-compatible providers converged on for
							// streamed reasoning summaries.
							controller.enqueue(
								chunk([
									{
										index: 0,
										delta: { reasoning_content: part.text },
										finish_reason: null,
									},
								]),
							)
							break
						case "tool-input-start": {
							const nextIndex = toolIndexes.size
							toolIndexes.set(part.id, nextIndex)
							controller.enqueue(
								chunk([
									{
										index: 0,
										delta: {
											tool_calls: [
												{
													index: nextIndex,
													id: part.id,
													type: "function",
													function: { name: part.toolName, arguments: "" },
												},
											],
										},
										finish_reason: null,
									},
								]),
							)
							break
						}
						case "tool-input-delta": {
							const index = toolIndexes.get(part.id)
							if (index == null) {
								break
							}
							toolsWithDeltas.add(part.id)
							controller.enqueue(
								chunk([
									{
										index: 0,
										delta: {
											tool_calls: [
												{ index, function: { arguments: part.delta } },
											],
										},
										finish_reason: null,
									},
								]),
							)
							break
						}
						case "tool-call": {
							// Some models return tool arguments in one shot with no
							// streamed deltas; emit them from the final event instead.
							const index = toolIndexes.get(part.toolCallId)
							if (index == null || toolsWithDeltas.has(part.toolCallId)) {
								break
							}
							controller.enqueue(
								chunk([
									{
										index: 0,
										delta: {
											tool_calls: [
												{
													index,
													function: { arguments: JSON.stringify(part.input) },
												},
											],
										},
										finish_reason: null,
									},
								]),
							)
							break
						}
						case "finish":
							controller.enqueue(
								chunk([
									{
										index: 0,
										delta: {},
										finish_reason: mapFinishReason(part.finishReason),
									},
								]),
							)
							controller.enqueue(chunk([], toUsage(part.totalUsage)))
							break
						case "error":
							throw part.error instanceof Error
								? part.error
								: new Error("Streaming chat completion failed.", {
										cause: part.error,
									})
					}
				}
			} catch (error) {
				// The response headers are already flushed, so surface the failure
				// as a terminal SSE frame rather than an HTTP status.
				controller.enqueue(
					encodeSse({
						error: {
							message:
								error instanceof Error
									? error.message
									: "Streaming chat completion failed.",
							type: "upstream_error",
						},
					}),
				)
				controller.enqueue(encodeDone())
				controller.close()
				return
			}

			controller.enqueue(encodeDone())
			controller.close()
		},
	})

	return new Response(stream, { status: 200, headers: sseHeaders })
}

export const handleChatCompletions = async (
	request: Request,
	provider: OpenAIOAuthProvider,
): Promise<Response> => {
	const body: unknown = await request.json()
	if (!isRecord(body) || !Array.isArray(body.messages)) {
		return errorResponse("`messages` must be an array.")
	}

	const chatRequest = body as ChatRequest
	if (chatRequest.stream === true) {
		return streamChatCompletions(chatRequest, provider)
	}

	const result = await generateText(toCallOptions(chatRequest, provider))
	const toolCalls = result.toolCalls.map((toolCall) => ({
		id: toolCall.toolCallId,
		type: "function",
		function: {
			name: toolCall.toolName,
			arguments: JSON.stringify(toolCall.input),
		},
	}))

	return new Response(
		JSON.stringify({
			id: `chatcmpl_${crypto.randomUUID()}`,
			object: "chat.completion",
			created: Math.floor(Date.now() / 1000),
			model: chatRequest.model ?? DEFAULT_MODEL,
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content: result.text.length > 0 ? result.text : null,
						reasoning_content: result.reasoningText || undefined,
						tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
					},
					finish_reason: mapFinishReason(result.finishReason),
				},
			],
			usage: toUsage(result.usage),
		}),
		{
			status: 200,
			headers: { "content-type": "application/json; charset=utf-8" },
		},
	)
}
