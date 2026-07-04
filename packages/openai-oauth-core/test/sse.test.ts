import { describe, expect, test } from "vitest"
import {
	collectCompletedResponseFromSse,
	iterateServerSentEvents,
	normalizeCodexResponsesSseStream,
	type ServerSentEvent,
} from "../src/index.js"

const encoder = new TextEncoder()

const buildStream = (chunks: string[]): ReadableStream<Uint8Array> =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk))
			}
			controller.close()
		},
	})

const sseEvent = (event: string, data: Record<string, unknown>): string =>
	`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

const collectEvents = async (
	stream: ReadableStream<Uint8Array>,
): Promise<ServerSentEvent[]> => {
	const collected: ServerSentEvent[] = []
	for await (const event of iterateServerSentEvents(stream)) {
		collected.push(event)
	}
	return collected
}

const parseData = (event: ServerSentEvent): Record<string, unknown> => {
	expect(event.data).toBeDefined()
	return JSON.parse(event.data as string) as Record<string, unknown>
}

describe("normalizeCodexResponsesSseStream", () => {
	test("synthesizes arguments.delta + .done when Codex skips them", async () => {
		const itemId = "fc_codex_spark_1"
		const args = '{"command":"ls -la /tmp"}'

		const upstream = buildStream([
			sseEvent("response.created", { type: "response.created" }),
			sseEvent("response.output_item.added", {
				type: "response.output_item.added",
				output_index: 0,
				item: {
					type: "function_call",
					id: itemId,
					call_id: "call_1",
					name: "run_shell",
					arguments: "",
					status: "in_progress",
				},
				sequence_number: 1,
			}),
			sseEvent("response.output_item.done", {
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "function_call",
					id: itemId,
					call_id: "call_1",
					name: "run_shell",
					arguments: args,
					status: "completed",
				},
				sequence_number: 2,
			}),
			sseEvent("response.completed", {
				type: "response.completed",
				response: { status: "completed" },
			}),
		])

		const events = await collectEvents(normalizeCodexResponsesSseStream(upstream))
		const types = events.map((event) => event.event)

		expect(types).toEqual([
			"response.created",
			"response.output_item.added",
			"response.function_call_arguments.delta",
			"response.function_call_arguments.done",
			"response.output_item.done",
			"response.completed",
		])

		const deltaEvent = parseData(events[2])
		expect(deltaEvent).toMatchObject({
			type: "response.function_call_arguments.delta",
			item_id: itemId,
			output_index: 0,
			delta: args,
		})

		const doneEvent = parseData(events[3])
		expect(doneEvent).toMatchObject({
			type: "response.function_call_arguments.done",
			item_id: itemId,
			output_index: 0,
			arguments: args,
		})

		const deltaSeq = deltaEvent.sequence_number as number
		const doneSeq = doneEvent.sequence_number as number
		expect(deltaSeq).toBeGreaterThanOrEqual(3)
		expect(doneSeq).toBe(deltaSeq + 1)
	})

	test("synthesizes only the missing .delta when Codex emits native .done without .delta", async () => {
		// Observed with gpt-5.3-codex-spark: it emits response.function_call_arguments.done
		// natively with the full arguments string but skips the preceding .delta event.
		const itemId = "fc_codex_spark_done_only"
		const args = '{"command":"ls -la /tmp"}'

		const upstream = buildStream([
			sseEvent("response.output_item.added", {
				type: "response.output_item.added",
				output_index: 0,
				item: {
					type: "function_call",
					id: itemId,
					name: "run_shell",
					arguments: "",
					status: "in_progress",
				},
				sequence_number: 1,
			}),
			sseEvent("response.function_call_arguments.done", {
				type: "response.function_call_arguments.done",
				item_id: itemId,
				output_index: 0,
				arguments: args,
				sequence_number: 2,
			}),
			sseEvent("response.output_item.done", {
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "function_call",
					id: itemId,
					name: "run_shell",
					arguments: args,
					status: "completed",
				},
				sequence_number: 3,
			}),
		])

		const events = await collectEvents(normalizeCodexResponsesSseStream(upstream))

		const deltaEvents = events.filter(
			(event) => event.event === "response.function_call_arguments.delta",
		)
		const doneEvents = events.filter(
			(event) => event.event === "response.function_call_arguments.done",
		)

		expect(deltaEvents).toHaveLength(1)
		expect(doneEvents).toHaveLength(1)

		expect(parseData(deltaEvents[0])).toMatchObject({
			type: "response.function_call_arguments.delta",
			item_id: itemId,
			delta: args,
		})
	})

	test("does not duplicate arguments events when Codex already streams deltas", async () => {
		const itemId = "fc_codex_gpt54_1"
		const args = '{"command":"echo hi"}'

		const upstream = buildStream([
			sseEvent("response.output_item.added", {
				type: "response.output_item.added",
				output_index: 0,
				item: {
					type: "function_call",
					id: itemId,
					name: "run_shell",
					arguments: "",
					status: "in_progress",
				},
				sequence_number: 1,
			}),
			sseEvent("response.function_call_arguments.delta", {
				type: "response.function_call_arguments.delta",
				item_id: itemId,
				output_index: 0,
				delta: args,
				sequence_number: 2,
			}),
			sseEvent("response.function_call_arguments.done", {
				type: "response.function_call_arguments.done",
				item_id: itemId,
				output_index: 0,
				arguments: args,
				sequence_number: 3,
			}),
			sseEvent("response.output_item.done", {
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "function_call",
					id: itemId,
					name: "run_shell",
					arguments: args,
					status: "completed",
				},
				sequence_number: 4,
			}),
		])

		const events = await collectEvents(normalizeCodexResponsesSseStream(upstream))
		const argsEvents = events.filter(
			(event) =>
				event.event === "response.function_call_arguments.delta" ||
				event.event === "response.function_call_arguments.done",
		)
		expect(argsEvents).toHaveLength(2)
	})

	test("passes non-function-call output items through unchanged", async () => {
		const upstream = buildStream([
			sseEvent("response.output_item.done", {
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "message",
					id: "msg_1",
					role: "assistant",
					content: [{ type: "output_text", text: "hello" }],
					status: "completed",
				},
				sequence_number: 1,
			}),
		])

		const events = await collectEvents(normalizeCodexResponsesSseStream(upstream))
		expect(events.map((event) => event.event)).toEqual([
			"response.output_item.done",
		])
	})

	test("handles multiple function calls independently", async () => {
		const upstream = buildStream([
			sseEvent("response.output_item.done", {
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "function_call",
					id: "fc_a",
					name: "tool_a",
					arguments: '{"a":1}',
				},
				sequence_number: 1,
			}),
			sseEvent("response.output_item.done", {
				type: "response.output_item.done",
				output_index: 1,
				item: {
					type: "function_call",
					id: "fc_b",
					name: "tool_b",
					arguments: '{"b":2}',
				},
				sequence_number: 2,
			}),
		])

		const events = await collectEvents(normalizeCodexResponsesSseStream(upstream))
		const synthesizedDeltas = events.filter(
			(event) => event.event === "response.function_call_arguments.delta",
		)
		expect(synthesizedDeltas).toHaveLength(2)
		expect((parseData(synthesizedDeltas[0]) as { item_id: string }).item_id).toBe("fc_a")
		expect((parseData(synthesizedDeltas[1]) as { item_id: string }).item_id).toBe("fc_b")
	})

	test("skips synthesis when arguments are empty", async () => {
		const upstream = buildStream([
			sseEvent("response.output_item.done", {
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "function_call",
					id: "fc_empty",
					name: "noop",
					arguments: "",
				},
				sequence_number: 1,
			}),
		])

		const events = await collectEvents(normalizeCodexResponsesSseStream(upstream))
		expect(
			events.some(
				(event) => event.event === "response.function_call_arguments.delta",
			),
		).toBe(false)
	})

	test("tolerates non-JSON data chunks", async () => {
		const upstream = buildStream([
			"event: raw\ndata: not-json\n\n",
			sseEvent("response.completed", { type: "response.completed" }),
		])

		const events = await collectEvents(normalizeCodexResponsesSseStream(upstream))
		expect(events.map((event) => event.event)).toEqual([
			"raw",
			"response.completed",
		])
		expect(events[0].data).toBe("not-json")
	})
})

describe("collectCompletedResponseFromSse", () => {
	test("returns response.completed.response when output is populated", async () => {
		const upstream = buildStream([
			sseEvent("response.created", {
				type: "response.created",
				response: { id: "resp_1", output: [], status: "in_progress" },
			}),
			sseEvent("response.completed", {
				type: "response.completed",
				response: {
					id: "resp_1",
					status: "completed",
					output: [
						{
							type: "message",
							id: "msg_1",
							content: [{ type: "output_text", text: "hi" }],
						},
					],
					usage: { input_tokens: 3, output_tokens: 1 },
				},
			}),
		])
		const completed = await collectCompletedResponseFromSse(upstream)
		expect(completed.id).toBe("resp_1")
		expect(Array.isArray(completed.output)).toBe(true)
		expect((completed.output as unknown[]).length).toBe(1)
	})

	test("rebuilds output from streamed items when response.completed.output is empty", async () => {
		// Observed: Codex sometimes emits a `response.completed` event whose
		// `response.output` is empty even though individual items were streamed
		// via `response.output_item.done`. Without this fallback the
		// non-streaming client path returns an empty-content assistant turn.
		const reasoningItem = {
			type: "reasoning",
			id: "rs_1",
			summary: [{ type: "summary_text", text: "thinking about math" }],
		}
		const messageItem = {
			type: "message",
			id: "msg_1",
			content: [{ type: "output_text", text: "391" }],
		}
		const upstream = buildStream([
			sseEvent("response.created", {
				type: "response.created",
				response: { id: "resp_2", output: [], status: "in_progress" },
			}),
			sseEvent("response.output_item.done", {
				type: "response.output_item.done",
				output_index: 0,
				item: reasoningItem,
			}),
			sseEvent("response.output_item.done", {
				type: "response.output_item.done",
				output_index: 1,
				item: messageItem,
			}),
			sseEvent("response.completed", {
				type: "response.completed",
				response: {
					id: "resp_2",
					status: "completed",
					output: [],
					usage: { input_tokens: 10, output_tokens: 5 },
				},
			}),
		])
		const completed = await collectCompletedResponseFromSse(upstream)
		expect(Array.isArray(completed.output)).toBe(true)
		const output = completed.output as Record<string, unknown>[]
		expect(output.length).toBe(2)
		expect(output[0]).toMatchObject({ type: "reasoning", id: "rs_1" })
		expect(output[1]).toMatchObject({ type: "message", id: "msg_1" })
	})

	test("prefers the final output_item.done payload when the same id is emitted twice", async () => {
		const upstream = buildStream([
			sseEvent("response.created", {
				type: "response.created",
				response: { id: "resp_3", output: [], status: "in_progress" },
			}),
			sseEvent("response.output_item.done", {
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "reasoning",
					id: "rs_1",
					summary: [{ type: "summary_text", text: "partial" }],
				},
			}),
			sseEvent("response.output_item.done", {
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "reasoning",
					id: "rs_1",
					summary: [{ type: "summary_text", text: "final" }],
				},
			}),
			sseEvent("response.completed", {
				type: "response.completed",
				response: { id: "resp_3", status: "completed", output: [] },
			}),
		])
		const completed = await collectCompletedResponseFromSse(upstream)
		const output = completed.output as Record<string, unknown>[]
		expect(output.length).toBe(1)
		const summary = (output[0] as Record<string, unknown>).summary as Record<
			string,
			unknown
		>[]
		expect((summary[0] as Record<string, unknown>).text).toBe("final")
	})

	test("throws when no response event is ever seen", async () => {
		const upstream = buildStream([
			sseEvent("response.output_item.done", {
				type: "response.output_item.done",
				output_index: 0,
				item: { type: "message", id: "msg_x", content: [] },
			}),
		])
		await expect(collectCompletedResponseFromSse(upstream)).rejects.toThrow(
			/No completed response found/,
		)
	})
})
