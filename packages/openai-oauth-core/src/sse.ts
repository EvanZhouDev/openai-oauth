const SSE_SEPARATOR = /\r?\n\r?\n/

export type ServerSentEvent = {
	event?: string
	data?: string
}

const parseEventBlock = (block: string): ServerSentEvent => {
	const event: ServerSentEvent = {}
	const dataLines: string[] = []

	for (const line of block.split(/\r?\n/)) {
		if (line.startsWith("event:")) {
			event.event = line.slice(6).trim()
			continue
		}

		if (line.startsWith("data:")) {
			dataLines.push(line.slice(5).trimStart())
		}
	}

	if (dataLines.length > 0) {
		event.data = dataLines.join("\n")
	}

	return event
}

export async function* iterateServerSentEvents(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerSentEvent> {
	const reader = stream.getReader()
	const decoder = new TextDecoder()
	let buffer = ""

	try {
		while (true) {
			const { value, done } = await reader.read()
			if (done) {
				break
			}

			buffer += decoder.decode(value, { stream: true })
			const blocks = buffer.split(SSE_SEPARATOR)
			buffer = blocks.pop() ?? ""

			for (const block of blocks) {
				if (block.trim().length > 0) {
					yield parseEventBlock(block)
				}
			}
		}

		if (buffer.trim().length > 0) {
			yield parseEventBlock(buffer)
		}
	} finally {
		reader.releaseLock()
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const encodeSseEvent = (event: ServerSentEvent): string => {
	const parts: string[] = []
	if (event.event) {
		parts.push(`event: ${event.event}`)
	}
	if (event.data !== undefined) {
		for (const line of event.data.split("\n")) {
			parts.push(`data: ${line}`)
		}
	}
	return `${parts.join("\n")}\n\n`
}

/**
 * Translates a Codex Responses-API SSE stream into a strictly-conforming
 * OpenAI Responses-API SSE stream by synthesizing missing
 * `response.function_call_arguments.delta` and `.done` events.
 *
 * Background: some Codex reasoning models (notably `gpt-5.3-codex-spark`)
 * emit tool-call arguments in one shot on `response.output_item.done` and
 * skip the intermediate `response.function_call_arguments.delta` /
 * `.done` pair that the public Responses-API spec requires. Downstream
 * clients (LiteLLM's Anthropic-Messages adapter, cursor, etc.) assemble
 * the final arguments string from those delta events; without them they
 * end up with empty arguments (e.g. `Bash` tool_use with `input: {}`).
 *
 * This transformer inspects each event, tracks which `item_id`s have seen
 * native `.delta` and `.done` events, and when a `response.output_item.done`
 * arrives carrying a `function_call` with non-empty `arguments`, synthesizes
 * each of the two argument events that Codex skipped — and only those —
 * immediately before re-emitting `output_item.done`. Models that stream
 * spec-compliantly are unaffected; models that emit neither event get both
 * synthesized; `gpt-5.3-codex-spark` (which emits `.done` natively but
 * skips `.delta`) gets only the `.delta` event synthesized, avoiding a
 * duplicate `.done`.
 *
 * Ordering caveat: when Codex emits its native `.done` before
 * `output_item.done`, any synthesized `.delta` lands *after* the native
 * `.done` in wall-clock order. Per spec `.delta` precedes `.done`, but
 * real-world consumers (LiteLLM's Anthropic-Messages adapter, etc.) just
 * accumulate `.delta` payloads regardless of position. Reordering would
 * require buffering the entire item, which is not worth the complexity.
 */
export const normalizeCodexResponsesSseStream = (
	stream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> => {
	const encoder = new TextEncoder()
	const seenDeltas = new Set<string>()
	const seenDones = new Set<string>()
	let nextSequenceNumber = 0

	const makeDeltaEvent = (
		itemId: string,
		outputIndex: number,
		args: string,
	): ServerSentEvent => ({
		event: "response.function_call_arguments.delta",
		data: JSON.stringify({
			type: "response.function_call_arguments.delta",
			item_id: itemId,
			output_index: outputIndex,
			delta: args,
			sequence_number: nextSequenceNumber++,
		}),
	})

	const makeDoneEvent = (
		itemId: string,
		outputIndex: number,
		args: string,
	): ServerSentEvent => ({
		event: "response.function_call_arguments.done",
		data: JSON.stringify({
			type: "response.function_call_arguments.done",
			item_id: itemId,
			output_index: outputIndex,
			arguments: args,
			sequence_number: nextSequenceNumber++,
		}),
	})

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				for await (const event of iterateServerSentEvents(stream)) {
					let parsed: Record<string, unknown> | undefined
					if (typeof event.data === "string" && event.data.length > 0) {
						try {
							const obj = JSON.parse(event.data)
							if (isRecord(obj)) {
								parsed = obj
								const seq = obj.sequence_number
								if (typeof seq === "number" && seq >= nextSequenceNumber) {
									nextSequenceNumber = seq + 1
								}
							}
						} catch {}
					}

					if (
						parsed &&
						parsed.type === "response.function_call_arguments.delta"
					) {
						const itemId = parsed.item_id
						if (typeof itemId === "string") {
							seenDeltas.add(itemId)
						}
					}

					if (
						parsed &&
						parsed.type === "response.function_call_arguments.done"
					) {
						const itemId = parsed.item_id
						if (typeof itemId === "string") {
							seenDones.add(itemId)
						}
					}

					if (
						parsed &&
						parsed.type === "response.output_item.done" &&
						isRecord(parsed.item) &&
						parsed.item.type === "function_call"
					) {
						const item = parsed.item
						const itemId = typeof item.id === "string" ? item.id : undefined
						const args =
							typeof item.arguments === "string" ? item.arguments : ""
						const outputIndex =
							typeof parsed.output_index === "number" ? parsed.output_index : 0

						if (itemId && args.length > 0) {
							if (!seenDeltas.has(itemId)) {
								controller.enqueue(
									encoder.encode(
										encodeSseEvent(
											makeDeltaEvent(itemId, outputIndex, args),
										),
									),
								)
								seenDeltas.add(itemId)
							}
							if (!seenDones.has(itemId)) {
								controller.enqueue(
									encoder.encode(
										encodeSseEvent(makeDoneEvent(itemId, outputIndex, args)),
									),
								)
								seenDones.add(itemId)
							}
						}
					}

					controller.enqueue(encoder.encode(encodeSseEvent(event)))
				}
			} catch (error) {
				controller.error(error)
				return
			}
			controller.close()
		},
	})
}

export const collectCompletedResponseFromSse = async (
	stream: ReadableStream<Uint8Array>,
): Promise<Record<string, unknown>> => {
	let latestResponse: Record<string, unknown> | undefined
	let latestError: unknown
	// Aggregate finished output items as they stream by. Codex's
	// `response.completed.response.output` is not always populated when items
	// were delivered as separate `response.output_item.done` events — if the
	// final response payload lacks `output`, we reconstruct it from these.
	// Tracked by item id so a later `output_item.done` for the same id
	// (final state after all deltas) wins over an earlier emission.
	const streamedItemsById = new Map<string, Record<string, unknown>>()
	const streamedItemsOrder: string[] = []
	const streamedItemsAnonymous: Record<string, unknown>[] = []

	const rememberItem = (item: Record<string, unknown>): void => {
		const id = typeof item.id === "string" ? item.id : undefined
		if (id) {
			if (!streamedItemsById.has(id)) {
				streamedItemsOrder.push(id)
			}
			streamedItemsById.set(id, item)
		} else {
			streamedItemsAnonymous.push(item)
		}
	}

	for await (const event of iterateServerSentEvents(stream)) {
		if (typeof event.data !== "string" || event.data.length === 0) {
			continue
		}

		try {
			const parsed = JSON.parse(event.data)
			if (!isRecord(parsed)) {
				continue
			}

			if (event.event === "error") {
				latestError = parsed
				continue
			}

			if (
				parsed.type === "response.output_item.done" &&
				isRecord(parsed.item)
			) {
				rememberItem(parsed.item)
			}

			const response = parsed.response
			if (isRecord(response)) {
				latestResponse = response
			}
		} catch {}
	}

	if (latestResponse) {
		const existingOutput = Array.isArray(latestResponse.output)
			? (latestResponse.output as unknown[])
			: []
		if (
			existingOutput.length === 0 &&
			(streamedItemsOrder.length > 0 || streamedItemsAnonymous.length > 0)
		) {
			const rebuilt: Record<string, unknown>[] = [
				...streamedItemsOrder.map(
					(id) => streamedItemsById.get(id) as Record<string, unknown>,
				),
				...streamedItemsAnonymous,
			]
			return { ...latestResponse, output: rebuilt }
		}
		return latestResponse
	}

	throw new Error(
		`No completed response found in SSE stream.${latestError ? ` Last error: ${JSON.stringify(latestError)}` : ""}`,
	)
}
