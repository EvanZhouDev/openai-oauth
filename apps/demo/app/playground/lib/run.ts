import { openaiAuthHeaders } from "@openai-oauth/react"
import { isRecord, parseJson, readNumber, readSse, readString } from "./sse"
import { playgroundTools, runTool } from "./tools"
import {
	type EndpointId,
	type HistoryItem,
	MAX_TOOL_ROUNDS,
	type RunEvent,
	type RunOptions,
	type ToolCallRecord,
	type Usage,
} from "./types"

export const endpointPath: Record<EndpointId, string> = {
	responses: "/api/v1/responses",
	"chat-completions": "/api/v1/chat/completions",
}

export const endpointLabel: Record<EndpointId, string> = {
	responses: "/v1/responses",
	"chat-completions": "/v1/chat/completions",
}

type PendingToolCall = {
	callId: string
	name: string
	args: string
}

type RoundResult = {
	text: string
	reasoning: string
	toolCalls: PendingToolCall[]
	responsesItems?: unknown[]
	usage?: Usage
	finishReason?: string
}

const emptyRound = (): RoundResult => ({
	text: "",
	reasoning: "",
	toolCalls: [],
})

const newId = (prefix: string) =>
	`${prefix}_${globalThis.crypto.randomUUID().slice(0, 8)}`

const toResponsesTools = () =>
	playgroundTools.map((entry) => ({
		type: "function",
		name: entry.name,
		description: entry.description,
		parameters: entry.parameters,
		strict: false,
	}))

const toChatTools = () =>
	playgroundTools.map((entry) => ({
		type: "function",
		function: {
			name: entry.name,
			description: entry.description,
			parameters: entry.parameters,
		},
	}))

const toResponsesInput = (history: HistoryItem[]): unknown[] => {
	const input: unknown[] = []

	for (const item of history) {
		if (item.kind === "user") {
			input.push({
				role: "user",
				content: [{ type: "input_text", text: item.text }],
			})
			continue
		}

		if (item.kind === "assistant") {
			// Replaying the verbatim output items keeps encrypted reasoning
			// attached; only synthesise when the turn came from the chat endpoint.
			if (item.responsesItems && item.responsesItems.length > 0) {
				input.push(...item.responsesItems)
				continue
			}

			if (item.text.length > 0) {
				input.push({
					role: "assistant",
					content: [{ type: "output_text", text: item.text }],
				})
			}
			for (const call of item.toolCalls) {
				input.push({
					type: "function_call",
					call_id: call.callId,
					name: call.name,
					arguments: call.arguments || "{}",
				})
			}
			continue
		}

		input.push({
			type: "function_call_output",
			call_id: item.callId,
			output: item.output,
		})
	}

	return input
}

const toChatMessages = (
	instructions: string,
	history: HistoryItem[],
): unknown[] => {
	const messages: unknown[] = []
	if (instructions.trim().length > 0) {
		messages.push({ role: "system", content: instructions })
	}

	for (const item of history) {
		if (item.kind === "user") {
			messages.push({ role: "user", content: item.text })
			continue
		}

		if (item.kind === "assistant") {
			if (item.text.length === 0 && item.toolCalls.length === 0) {
				continue
			}
			messages.push({
				role: "assistant",
				content: item.text.length > 0 ? item.text : null,
				tool_calls:
					item.toolCalls.length > 0
						? item.toolCalls.map((call) => ({
								id: call.callId,
								type: "function",
								function: {
									name: call.name,
									arguments: call.arguments || "{}",
								},
							}))
						: undefined,
			})
			continue
		}

		messages.push({
			role: "tool",
			tool_call_id: item.callId,
			content: item.output,
		})
	}

	return messages
}

const toResponsesUsage = (value: unknown): Usage | undefined => {
	if (!isRecord(value)) {
		return undefined
	}
	const outputDetails = isRecord(value.output_tokens_details)
		? value.output_tokens_details
		: undefined
	const inputDetails = isRecord(value.input_tokens_details)
		? value.input_tokens_details
		: undefined

	return {
		input: readNumber(value, "input_tokens"),
		output: readNumber(value, "output_tokens"),
		total: readNumber(value, "total_tokens"),
		reasoning: readNumber(outputDetails, "reasoning_tokens"),
		cached: readNumber(inputDetails, "cached_tokens"),
	}
}

const toChatUsage = (value: unknown): Usage | undefined => {
	if (!isRecord(value)) {
		return undefined
	}
	const outputDetails = isRecord(value.completion_tokens_details)
		? value.completion_tokens_details
		: undefined
	const inputDetails = isRecord(value.prompt_tokens_details)
		? value.prompt_tokens_details
		: undefined

	return {
		input: readNumber(value, "prompt_tokens"),
		output: readNumber(value, "completion_tokens"),
		total: readNumber(value, "total_tokens"),
		reasoning: readNumber(outputDetails, "reasoning_tokens"),
		cached: readNumber(inputDetails, "cached_tokens"),
	}
}

const toRequestError = async (response: Response): Promise<string> => {
	const text = await response.text()
	const parsed = parseJson(text)
	if (isRecord(parsed) && isRecord(parsed.error)) {
		const message = readString(parsed.error, "message")
		if (message) {
			return message
		}
	}
	return text || `Request failed with HTTP ${response.status}.`
}

const postJson = async (
	path: string,
	body: unknown,
	signal: AbortSignal,
): Promise<Response> =>
	fetch(path, {
		method: "POST",
		headers: {
			...(await openaiAuthHeaders()),
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal,
	})

/** Walks the `output` array of a completed `/v1/responses` payload. */
function* drainResponsesOutput(
	output: unknown[],
	round: RoundResult,
): Generator<RunEvent> {
	for (const item of output) {
		if (!isRecord(item)) {
			continue
		}

		if (item.type === "reasoning" && Array.isArray(item.summary)) {
			for (const part of item.summary) {
				const text = isRecord(part) ? readString(part, "text") : undefined
				if (text) {
					round.reasoning += round.reasoning.length > 0 ? `\n\n${text}` : text
					yield { type: "reasoning-delta", delta: text }
				}
			}
			continue
		}

		if (item.type === "message" && Array.isArray(item.content)) {
			for (const part of item.content) {
				const text = isRecord(part) ? readString(part, "text") : undefined
				if (text) {
					round.text += text
					yield { type: "text-delta", delta: text }
				}
			}
			continue
		}

		if (item.type === "function_call") {
			const callId =
				readString(item, "call_id") ?? readString(item, "id") ?? newId("call")
			const name = readString(item, "name") ?? "unknown_tool"
			const args = readString(item, "arguments") ?? "{}"

			round.toolCalls.push({ callId, name, args })
			yield { type: "tool-call-start", callId, name }
			yield { type: "tool-args-delta", callId, delta: args }
			yield { type: "tool-call-end", callId, name, args }
		}
	}
}

async function* runResponsesRound(
	options: RunOptions,
	history: HistoryItem[],
): AsyncGenerator<RunEvent, RoundResult> {
	const round = emptyRound()
	const body = {
		model: options.model,
		instructions: options.instructions.trim() || undefined,
		input: toResponsesInput(history),
		stream: options.stream,
		reasoning: { effort: options.reasoningEffort, summary: "auto" },
		tools: options.toolsEnabled ? toResponsesTools() : undefined,
		tool_choice: options.toolsEnabled ? "auto" : undefined,
	}

	yield {
		type: "request",
		endpoint: "responses",
		url: endpointPath.responses,
		body,
	}

	const response = await postJson(endpointPath.responses, body, options.signal)
	if (!response.ok) {
		throw new Error(await toRequestError(response))
	}

	if (!options.stream || !response.body) {
		const payload: unknown = await response.json()
		yield { type: "response", label: "response object", payload }

		if (isRecord(payload) && Array.isArray(payload.output)) {
			round.responsesItems = payload.output
			yield* drainResponsesOutput(payload.output, round)
			round.usage = toResponsesUsage(payload.usage)
			round.finishReason =
				round.toolCalls.length > 0
					? "tool_calls"
					: (readString(payload, "status") ?? "completed")
		}
		return round
	}

	// item id -> call id, because argument deltas are keyed by output item.
	const callIdByItem = new Map<string, string>()
	const nameByItem = new Map<string, string>()
	const startedCalls = new Set<string>()
	const collectedItems: unknown[] = []

	for await (const message of readSse(response.body)) {
		if (message.data === "[DONE]") {
			break
		}

		const payload = parseJson(message.data)
		if (!isRecord(payload)) {
			continue
		}

		const type = readString(payload, "type") ?? message.event ?? "unknown"
		yield { type: "stream-event", label: type, payload }

		switch (type) {
			case "response.output_text.delta": {
				const delta = readString(payload, "delta")
				if (delta) {
					round.text += delta
					yield { type: "text-delta", delta }
				}
				break
			}

			case "response.reasoning_summary_text.delta":
			case "response.reasoning_text.delta": {
				const delta = readString(payload, "delta")
				if (delta) {
					round.reasoning += delta
					yield { type: "reasoning-delta", delta }
				}
				break
			}

			case "response.reasoning_summary_part.added": {
				// Each summary part is a separate paragraph of the trace.
				if (round.reasoning.length > 0) {
					round.reasoning += "\n\n"
					yield { type: "reasoning-delta", delta: "\n\n" }
				}
				break
			}

			case "response.output_item.added": {
				const item = payload.item
				if (!isRecord(item) || item.type !== "function_call") {
					break
				}
				const itemId = readString(item, "id") ?? newId("item")
				const callId = readString(item, "call_id") ?? itemId
				const name = readString(item, "name") ?? "unknown_tool"

				callIdByItem.set(itemId, callId)
				nameByItem.set(itemId, name)
				startedCalls.add(callId)
				yield { type: "tool-call-start", callId, name }
				break
			}

			case "response.function_call_arguments.delta": {
				const itemId = readString(payload, "item_id")
				const delta = readString(payload, "delta")
				const callId = itemId ? callIdByItem.get(itemId) : undefined
				if (callId && delta) {
					yield { type: "tool-args-delta", callId, delta }
				}
				break
			}

			case "response.output_item.done": {
				const item = payload.item
				if (!isRecord(item)) {
					break
				}
				collectedItems.push(item)
				if (item.type !== "function_call") {
					break
				}

				const itemId = readString(item, "id") ?? ""
				const callId =
					readString(item, "call_id") ??
					callIdByItem.get(itemId) ??
					newId("call")
				const name =
					readString(item, "name") ?? nameByItem.get(itemId) ?? "unknown_tool"
				const args = readString(item, "arguments") ?? "{}"

				if (!startedCalls.has(callId)) {
					// Some models emit the completed item without an `added` event.
					yield { type: "tool-call-start", callId, name }
					yield { type: "tool-args-delta", callId, delta: args }
				}
				round.toolCalls.push({ callId, name, args })
				yield { type: "tool-call-end", callId, name, args }
				break
			}

			case "response.completed":
			case "response.incomplete": {
				const completed = payload.response
				if (isRecord(completed)) {
					if (Array.isArray(completed.output)) {
						round.responsesItems = completed.output
					}
					round.usage = toResponsesUsage(completed.usage)
					round.finishReason = readString(completed, "status") ?? type
				}
				break
			}

			case "response.failed":
			case "error": {
				const detail = isRecord(payload.response)
					? payload.response.error
					: payload.error
				const message = isRecord(detail)
					? (readString(detail, "message") ?? "The request failed upstream.")
					: (readString(payload, "message") ?? "The request failed upstream.")
				throw new Error(message)
			}
		}
	}

	round.responsesItems ??= collectedItems
	round.finishReason ??= round.toolCalls.length > 0 ? "tool_calls" : "completed"
	return round
}

async function* runChatRound(
	options: RunOptions,
	history: HistoryItem[],
): AsyncGenerator<RunEvent, RoundResult> {
	const round = emptyRound()
	const body = {
		model: options.model,
		messages: toChatMessages(options.instructions, history),
		stream: options.stream,
		reasoning_effort: options.reasoningEffort,
		tools: options.toolsEnabled ? toChatTools() : undefined,
		tool_choice: options.toolsEnabled ? "auto" : undefined,
	}

	yield {
		type: "request",
		endpoint: "chat-completions",
		url: endpointPath["chat-completions"],
		body,
	}

	const response = await postJson(
		endpointPath["chat-completions"],
		body,
		options.signal,
	)
	if (!response.ok) {
		throw new Error(await toRequestError(response))
	}

	if (!options.stream || !response.body) {
		const payload: unknown = await response.json()
		yield { type: "response", label: "chat.completion", payload }

		if (!isRecord(payload) || !Array.isArray(payload.choices)) {
			return round
		}

		const choice = payload.choices[0]
		const message = isRecord(choice) ? choice.message : undefined
		if (isRecord(message)) {
			const reasoning = readString(message, "reasoning_content")
			if (reasoning) {
				round.reasoning = reasoning
				yield { type: "reasoning-delta", delta: reasoning }
			}

			const text = readString(message, "content")
			if (text) {
				round.text = text
				yield { type: "text-delta", delta: text }
			}

			for (const toolCall of Array.isArray(message.tool_calls)
				? message.tool_calls
				: []) {
				if (!isRecord(toolCall)) {
					continue
				}
				const fn = isRecord(toolCall.function) ? toolCall.function : {}
				const callId = readString(toolCall, "id") ?? newId("call")
				const name = readString(fn, "name") ?? "unknown_tool"
				const args = readString(fn, "arguments") ?? "{}"

				round.toolCalls.push({ callId, name, args })
				yield { type: "tool-call-start", callId, name }
				yield { type: "tool-args-delta", callId, delta: args }
				yield { type: "tool-call-end", callId, name, args }
			}
		}

		round.usage = toChatUsage(payload.usage)
		round.finishReason = isRecord(choice)
			? (readString(choice, "finish_reason") ?? undefined)
			: undefined
		return round
	}

	const callsByIndex = new Map<number, PendingToolCall>()

	for await (const message of readSse(response.body)) {
		if (message.data === "[DONE]") {
			break
		}

		const payload = parseJson(message.data)
		if (!isRecord(payload)) {
			continue
		}

		yield { type: "stream-event", label: "chat.completion.chunk", payload }

		if (isRecord(payload.error)) {
			throw new Error(
				readString(payload.error, "message") ?? "The request failed upstream.",
			)
		}

		const usage = toChatUsage(payload.usage)
		if (usage) {
			round.usage = usage
		}

		const choice = Array.isArray(payload.choices)
			? payload.choices[0]
			: undefined
		if (!isRecord(choice)) {
			continue
		}

		const finishReason = readString(choice, "finish_reason")
		if (finishReason) {
			round.finishReason = finishReason
		}

		const delta = isRecord(choice.delta) ? choice.delta : undefined
		if (!delta) {
			continue
		}

		const reasoningDelta = readString(delta, "reasoning_content")
		if (reasoningDelta) {
			round.reasoning += reasoningDelta
			yield { type: "reasoning-delta", delta: reasoningDelta }
		}

		const textDelta = readString(delta, "content")
		if (textDelta) {
			round.text += textDelta
			yield { type: "text-delta", delta: textDelta }
		}

		for (const entry of Array.isArray(delta.tool_calls)
			? delta.tool_calls
			: []) {
			if (!isRecord(entry)) {
				continue
			}
			const index = readNumber(entry, "index") ?? 0
			const fn = isRecord(entry.function) ? entry.function : {}
			const existing = callsByIndex.get(index)

			if (!existing) {
				const call: PendingToolCall = {
					callId: readString(entry, "id") ?? newId("call"),
					name: readString(fn, "name") ?? "unknown_tool",
					args: readString(fn, "arguments") ?? "",
				}
				callsByIndex.set(index, call)
				round.toolCalls.push(call)
				yield { type: "tool-call-start", callId: call.callId, name: call.name }
				if (call.args.length > 0) {
					yield {
						type: "tool-args-delta",
						callId: call.callId,
						delta: call.args,
					}
				}
				continue
			}

			const argsDelta = readString(fn, "arguments")
			if (argsDelta) {
				existing.args += argsDelta
				yield {
					type: "tool-args-delta",
					callId: existing.callId,
					delta: argsDelta,
				}
			}
		}
	}

	for (const call of round.toolCalls) {
		yield {
			type: "tool-call-end",
			callId: call.callId,
			name: call.name,
			args: call.args,
		}
	}

	round.finishReason ??= round.toolCalls.length > 0 ? "tool_calls" : "stop"
	return round
}

const mergeUsage = (
	left: Usage | undefined,
	right: Usage | undefined,
): Usage | undefined => {
	if (!left) {
		return right
	}
	if (!right) {
		return left
	}

	const add = (a: number | undefined, b: number | undefined) =>
		a == null && b == null ? undefined : (a ?? 0) + (b ?? 0)

	return {
		input: add(left.input, right.input),
		output: add(left.output, right.output),
		reasoning: add(left.reasoning, right.reasoning),
		cached: add(left.cached, right.cached),
		total: add(left.total, right.total),
	}
}

/**
 * Drives one user turn to completion: request, stream, run any tool calls,
 * then request again with the tool results until the model stops calling
 * tools or the round cap is hit.
 */
export async function* runConversation(
	options: RunOptions,
): AsyncGenerator<RunEvent> {
	const history = [...options.history]
	let usage: Usage | undefined
	let finishReason: string | undefined
	let rounds = 0
	const startedAt = performance.now()

	try {
		for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
			const assistantId = newId("assistant")
			yield { type: "assistant-start", id: assistantId }
			rounds += 1

			const result =
				options.endpoint === "responses"
					? yield* runResponsesRound(options, history)
					: yield* runChatRound(options, history)

			usage = mergeUsage(usage, result.usage)
			finishReason = result.finishReason

			const toolCalls: ToolCallRecord[] = result.toolCalls.map((call) => ({
				callId: call.callId,
				name: call.name,
				arguments: call.args,
				status: "done",
			}))

			history.push({
				kind: "assistant",
				id: assistantId,
				text: result.text,
				reasoning: result.reasoning,
				toolCalls,
				responsesItems: result.responsesItems,
			})

			if (result.toolCalls.length === 0) {
				break
			}

			for (const call of result.toolCalls) {
				const executed = runTool(call.name, call.args)
				const record = toolCalls.find((entry) => entry.callId === call.callId)
				if (record) {
					record.result = executed.output
					record.error = executed.error
					record.status = executed.error ? "error" : "done"
				}

				yield {
					type: "tool-result",
					callId: call.callId,
					name: call.name,
					output: executed.output,
					error: executed.error,
				}

				history.push({
					kind: "tool",
					id: newId("tool"),
					callId: call.callId,
					name: call.name,
					output: executed.output,
				})
			}

			if (round === MAX_TOOL_ROUNDS - 1) {
				yield {
					type: "error",
					message: `Stopped after ${MAX_TOOL_ROUNDS} tool rounds.`,
				}
			}
		}

		const meta = {
			endpoint: options.endpoint,
			model: options.model,
			stream: options.stream,
			rounds,
			latencyMs: Math.round(performance.now() - startedAt),
			finishReason,
			usage,
		}
		yield { type: "turn-meta", meta }
		yield { type: "history", items: history }
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			yield { type: "error", message: "Request stopped." }
		} else {
			yield {
				type: "error",
				message: error instanceof Error ? error.message : "The request failed.",
			}
		}
		yield { type: "history", items: history }
	}
}
