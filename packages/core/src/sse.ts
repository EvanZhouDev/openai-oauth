import { isRecord } from "./utils.js"

const SSE_SEPARATOR = /\r?\n\r?\n/

export type ServerSentEvent = {
	event?: string
	data?: string
}

export type CompletedResponseObserver = {
	onItemId?: (id: string) => void
	onResponseId?: (id: string) => void
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
	let reachedEnd = false

	try {
		while (true) {
			const { value, done } = await reader.read()
			if (done) {
				reachedEnd = true
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
		if (!reachedEnd) {
			void reader.cancel().catch(() => undefined)
		}
		reader.releaseLock()
	}
}

const observeEventIds = (
	event: ServerSentEvent,
	observer: CompletedResponseObserver,
): void => {
	if (typeof event.data !== "string") {
		return
	}

	try {
		const parsed = JSON.parse(event.data)
		if (!isRecord(parsed)) {
			return
		}

		const item = parsed.item
		if (isRecord(item) && typeof item.id === "string") {
			observer.onItemId?.(item.id)
		}

		const response = parsed.response
		if (isRecord(response) && typeof response.id === "string") {
			observer.onResponseId?.(response.id)
		}
		if (isRecord(response) && Array.isArray(response.output)) {
			for (const output of response.output) {
				if (isRecord(output) && typeof output.id === "string") {
					observer.onItemId?.(output.id)
				}
			}
		}
	} catch {}
}

export const observeServerSentEventIds = (
	stream: ReadableStream<Uint8Array>,
	observer: CompletedResponseObserver,
): ReadableStream<Uint8Array> => {
	const decoder = new TextDecoder()
	let buffer = ""

	return stream.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				buffer += decoder.decode(chunk, { stream: true })
				const blocks = buffer.split(SSE_SEPARATOR)
				buffer = blocks.pop() ?? ""
				for (const block of blocks) {
					if (block.trim().length > 0) {
						observeEventIds(parseEventBlock(block), observer)
					}
				}
				controller.enqueue(chunk)
			},
			flush() {
				buffer += decoder.decode()
				if (buffer.trim().length > 0) {
					observeEventIds(parseEventBlock(buffer), observer)
				}
			},
		}),
	)
}

const terminalServerSentEvents = new Set([
	"error",
	"response.completed",
	"response.failed",
	"response.cancelled",
	"response.canceled",
	"response.incomplete",
])

const terminalResponseStatuses = new Set([
	"completed",
	"failed",
	"cancelled",
	"canceled",
	"incomplete",
])

const isTerminalResponse = (
	response: Record<string, unknown> | undefined,
): response is Record<string, unknown> =>
	response != null &&
	typeof response.status === "string" &&
	terminalResponseStatuses.has(response.status)

const isTerminalPayload = (data: string): boolean => {
	if (data === "[DONE]") {
		return true
	}

	try {
		const parsed = JSON.parse(data)
		if (!isRecord(parsed)) {
			return false
		}

		const type = parsed.type
		if (typeof type === "string" && terminalServerSentEvents.has(type)) {
			return true
		}

		const response = parsed.response
		if (!isRecord(response)) {
			return false
		}

		const responseType = response.type
		const status = response.status
		return (
			(typeof responseType === "string" &&
				terminalServerSentEvents.has(responseType)) ||
			(typeof status === "string" && terminalResponseStatuses.has(status))
		)
	} catch {
		return false
	}
}

export const collectCompletedResponseFromSse = async (
	stream: ReadableStream<Uint8Array>,
): Promise<Record<string, unknown>> => {
	let latestResponse: Record<string, unknown> | undefined
	let latestError: unknown
	const outputItems = new Map<string, Record<string, unknown>>()

	const withCollectedOutput = (
		response: Record<string, unknown>,
	): Record<string, unknown> => {
		const output = Array.isArray(response.output) ? response.output : []
		if (output.length > 0 || outputItems.size === 0) {
			return response
		}

		return {
			...response,
			output: [...outputItems.values()],
		}
	}

	for await (const event of iterateServerSentEvents(stream)) {
		if (typeof event.data !== "string" || event.data.length === 0) {
			continue
		}

		const terminal = Boolean(
			(event.event && terminalServerSentEvents.has(event.event)) ||
				isTerminalPayload(event.data),
		)

		try {
			const parsed = JSON.parse(event.data)
			if (!isRecord(parsed)) {
				// Terminal handling below must still run for non-object payloads.
			} else if (event.event === "error" || parsed.type === "error") {
				latestError = parsed
			} else {
				const item = parsed.item
				if (isRecord(item) && typeof item.id === "string") {
					outputItems.set(item.id, item)
				}

				const response = parsed.response
				if (isRecord(response)) {
					latestResponse = response
				}
			}
		} catch {}

		if (terminal) {
			if (latestError) {
				throw new Error(
					`Response stream failed: ${JSON.stringify(latestError)}`,
				)
			}
			if (isTerminalResponse(latestResponse)) {
				return withCollectedOutput(latestResponse)
			}
			throw new Error("Response stream ended without a response")
		}
	}

	if (latestError) {
		throw new Error(`Response stream failed: ${JSON.stringify(latestError)}`)
	}

	if (isTerminalResponse(latestResponse)) {
		return withCollectedOutput(latestResponse)
	}

	throw new Error(
		`No completed response found in SSE stream.${latestError ? ` Last error: ${JSON.stringify(latestError)}` : ""}`,
	)
}
