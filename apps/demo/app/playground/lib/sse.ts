export type SseMessage = {
	event?: string
	data: string
}

/**
 * Minimal `text/event-stream` reader. Both `/v1/responses` (named events) and
 * `/v1/chat/completions` (data-only frames) are consumed through this.
 */
export async function* readSse(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseMessage> {
	const reader = body.getReader()
	const decoder = new TextDecoder()
	let buffer = ""

	try {
		while (true) {
			const { value, done } = await reader.read()
			if (done) {
				break
			}

			buffer += decoder.decode(value, { stream: true })

			let separator = buffer.search(/\r?\n\r?\n/)
			while (separator !== -1) {
				const frame = buffer.slice(0, separator)
				buffer = buffer.slice(separator + (buffer[separator] === "\r" ? 4 : 2))

				const message = parseFrame(frame)
				if (message) {
					yield message
				}

				separator = buffer.search(/\r?\n\r?\n/)
			}
		}

		const trailing = parseFrame(buffer)
		if (trailing) {
			yield trailing
		}
	} finally {
		reader.releaseLock()
	}
}

const parseFrame = (frame: string): SseMessage | undefined => {
	const dataLines: string[] = []
	let event: string | undefined

	for (const line of frame.split(/\r?\n/)) {
		if (line.startsWith(":") || line.length === 0) {
			continue
		}
		if (line.startsWith("event:")) {
			event = line.slice(6).trim()
			continue
		}
		if (line.startsWith("data:")) {
			dataLines.push(line.slice(5).replace(/^ /, ""))
		}
	}

	return dataLines.length > 0
		? { event, data: dataLines.join("\n") }
		: undefined
}

export const parseJson = (value: string): unknown => {
	try {
		return JSON.parse(value)
	} catch {
		return undefined
	}
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

export const readString = (
	value: Record<string, unknown>,
	key: string,
): string | undefined =>
	typeof value[key] === "string" ? value[key] : undefined

export const readNumber = (
	value: Record<string, unknown> | undefined,
	key: string,
): number | undefined =>
	value != null && typeof value[key] === "number" ? value[key] : undefined
