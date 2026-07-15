type JsonRecord = Record<string, unknown>

type CachedResponseEntry = {
	input: unknown[]
	output: JsonRecord[]
}

export type CodexResponsesStateSnapshot = {
	items: Array<{
		id: string
		item: JsonRecord
	}>
	responses: Array<{
		id: string
		input: unknown[]
		output: JsonRecord[]
	}>
}

export type CodexResponsesStateOptions = {
	snapshot?: CodexResponsesStateSnapshot
	onChange?: (snapshot: CodexResponsesStateSnapshot) => void
}

const MAX_ITEM_CACHE_SIZE = 2_000
const MAX_RESPONSE_CACHE_SIZE = 256

const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const cloneValue = <T>(value: T): T => structuredClone(value)

const trimOldestEntries = <T>(
	map: Map<string, T>,
	maxEntries: number,
): void => {
	while (map.size > maxEntries) {
		const oldestKey = map.keys().next().value
		if (oldestKey == null) {
			break
		}

		map.delete(oldestKey)
	}
}

export class CodexResponsesState {
	private readonly items = new Map<string, JsonRecord>()
	private readonly responses = new Map<string, CachedResponseEntry>()
	private readonly pendingCaptures = new Set<Promise<void>>()
	private readonly onChange?: (snapshot: CodexResponsesStateSnapshot) => void

	constructor(options: CodexResponsesStateOptions = {}) {
		this.onChange = options.onChange

		for (const entry of options.snapshot?.items ?? []) {
			if (typeof entry.id !== "string") {
				continue
			}

			this.items.set(entry.id, cloneValue(entry.item))
		}

		for (const entry of options.snapshot?.responses ?? []) {
			if (typeof entry.id !== "string") {
				continue
			}

			this.responses.set(entry.id, {
				input: entry.input.map((item) => cloneValue(item)),
				output: entry.output.map((item) => cloneValue(item)),
			})
		}

		trimOldestEntries(this.items, MAX_ITEM_CACHE_SIZE)
		trimOldestEntries(this.responses, MAX_RESPONSE_CACHE_SIZE)
	}

	async waitForPendingCaptures(): Promise<void> {
		if (this.pendingCaptures.size === 0) {
			return
		}

		await Promise.allSettled([...this.pendingCaptures])
	}

	trackPendingCapture(promise: Promise<void>): void {
		this.pendingCaptures.add(promise)
		void promise.finally(() => {
			this.pendingCaptures.delete(promise)
		})
	}

	requiresCachedState(body: JsonRecord): boolean {
		if (typeof body.previous_response_id === "string") {
			return true
		}

		if (!Array.isArray(body.input)) {
			return false
		}

		return body.input.some(
			(item) =>
				isRecord(item) &&
				item.type === "item_reference" &&
				typeof item.id === "string",
		)
	}

	expandRequestBody(body: JsonRecord): JsonRecord {
		const nextBody: JsonRecord = { ...body }
		const previousResponseId =
			typeof body.previous_response_id === "string"
				? body.previous_response_id
				: undefined
		const previousHistory =
			previousResponseId == null
				? undefined
				: this.responses.get(previousResponseId)
		const directInput = Array.isArray(body.input)
			? this.expandInput(body.input)
			: body.input

		if (previousHistory != null) {
			nextBody.input = [
				...cloneValue(previousHistory.input),
				...cloneValue(previousHistory.output),
				...(Array.isArray(directInput) ? directInput : []),
			]
			delete nextBody.previous_response_id
			return nextBody
		}

		if (Array.isArray(directInput)) {
			nextBody.input = directInput
		}

		return nextBody
	}

	rememberResponse(response: unknown, requestBody?: JsonRecord): void {
		if (!isRecord(response)) {
			return
		}

		let changed = false

		const responseId = typeof response.id === "string" ? response.id : undefined
		const output = Array.isArray(response.output)
			? response.output.filter(isRecord).map((item) => cloneValue(item))
			: []

		for (const item of output) {
			if (typeof item.id !== "string") {
				continue
			}

			this.items.delete(item.id)
			this.items.set(item.id, item)
			changed = true
		}

		trimOldestEntries(this.items, MAX_ITEM_CACHE_SIZE)

		if (responseId == null || requestBody == null) {
			if (changed) {
				this.emitChange()
			}
			return
		}

		const input = Array.isArray(requestBody.input)
			? requestBody.input.map((item) => cloneValue(item))
			: []

		this.responses.delete(responseId)
		this.responses.set(responseId, {
			input,
			output,
		})
		changed = true

		trimOldestEntries(this.responses, MAX_RESPONSE_CACHE_SIZE)

		if (changed) {
			this.emitChange()
		}
	}

	snapshot(): CodexResponsesStateSnapshot {
		return {
			items: [...this.items.entries()].map(([id, item]) => ({
				id,
				item: cloneValue(item),
			})),
			responses: [...this.responses.entries()].map(([id, response]) => ({
				id,
				input: response.input.map((item) => cloneValue(item)),
				output: response.output.map((item) => cloneValue(item)),
			})),
		}
	}

	private expandInput(input: unknown[]): unknown[] {
		return input.map((item) => {
			if (
				isRecord(item) &&
				item.type === "item_reference" &&
				typeof item.id === "string"
			) {
				const cachedItem = this.items.get(item.id)
				if (cachedItem != null) {
					return cloneValue(cachedItem)
				}
			}

			return cloneValue(item)
		})
	}

	private emitChange(): void {
		this.onChange?.(this.snapshot())
	}
}
