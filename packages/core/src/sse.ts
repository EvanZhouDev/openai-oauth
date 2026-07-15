import { isRecord } from "./utils.js"

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
				continue
			}

			if (event.event === "error") {
				latestError = parsed
				continue
			}

			const item = parsed.item
			if (isRecord(item) && typeof item.id === "string") {
				outputItems.set(item.id, item)
			}

			const response = parsed.response
			if (isRecord(response)) {
				latestResponse = response
			}

			if (terminal && latestResponse) {
				return withCollectedOutput(latestResponse)
			}
		} catch {}

		if (terminal && latestResponse) {
			return withCollectedOutput(latestResponse)
		}
	}

	if (latestResponse) {
		return withCollectedOutput(latestResponse)
	}

	throw new Error(
		`No completed response found in SSE stream.${latestError ? ` Last error: ${JSON.stringify(latestError)}` : ""}`,
	)
}
