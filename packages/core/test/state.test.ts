import { describe, expect, test } from "vitest"
import { CodexResponsesState } from "../src/state.js"

describe("CodexResponsesState", () => {
	test("expands cached item references into full items", () => {
		const state = new CodexResponsesState()
		state.rememberResponse(
			{
				id: "resp_1",
				output: [
					{
						id: "fc_1",
						type: "function_call",
						call_id: "call_1",
						name: "weather",
						arguments: '{"city":"San Francisco"}',
					},
				],
			},
			{
				input: [
					{
						role: "user",
						content: [{ type: "input_text", text: "Use the weather tool." }],
					},
				],
			},
		)

		const expanded = state.expandRequestBody({
			input: [
				{
					type: "item_reference",
					id: "fc_1",
				},
				{
					type: "function_call_output",
					call_id: "call_1",
					output: '{"tempC":21}',
				},
			],
		})

		expect(expanded.input).toEqual([
			{
				id: "fc_1",
				type: "function_call",
				call_id: "call_1",
				name: "weather",
				arguments: '{"city":"San Francisco"}',
			},
			{
				type: "function_call_output",
				call_id: "call_1",
				output: '{"tempC":21}',
			},
		])
	})

	test("expands previous_response_id into the cached conversation history", () => {
		const state = new CodexResponsesState()
		state.rememberResponse(
			{
				id: "resp_1",
				output: [
					{
						id: "msg_1",
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: "Hello there." }],
					},
				],
			},
			{
				input: [
					{
						role: "user",
						content: [{ type: "input_text", text: "Say hello." }],
					},
				],
			},
		)

		const expanded = state.expandRequestBody({
			previous_response_id: "resp_1",
			input: [
				{
					role: "user",
					content: [{ type: "input_text", text: "Now say goodbye." }],
				},
			],
		})

		expect(expanded.previous_response_id).toBeUndefined()
		expect(expanded.input).toEqual([
			{
				role: "user",
				content: [{ type: "input_text", text: "Say hello." }],
			},
			{
				id: "msg_1",
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "Hello there." }],
			},
			{
				role: "user",
				content: [{ type: "input_text", text: "Now say goodbye." }],
			},
		])
	})

	test("can restore from a snapshot", () => {
		const original = new CodexResponsesState()
		original.rememberResponse(
			{
				id: "resp_1",
				output: [
					{
						id: "msg_1",
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: "Persisted." }],
					},
				],
			},
			{
				input: [
					{
						role: "user",
						content: [{ type: "input_text", text: "Remember this." }],
					},
				],
			},
		)

		const restored = new CodexResponsesState({
			snapshot: original.snapshot(),
		})
		const expanded = restored.expandRequestBody({
			previous_response_id: "resp_1",
			input: [],
		})

		expect(expanded.input).toEqual([
			{
				role: "user",
				content: [{ type: "input_text", text: "Remember this." }],
			},
			{
				id: "msg_1",
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "Persisted." }],
			},
		])
	})

	test("uses configurable response and item cache bounds", () => {
		const state = new CodexResponsesState({
			maxResponses: 1,
			maxItems: 1,
		})

		state.rememberResponse(
			{
				id: "resp_1",
				output: [{ id: "msg_1", type: "message" }],
			},
			{ input: [{ role: "user", content: "First" }] },
		)
		state.rememberResponse(
			{
				id: "resp_2",
				output: [{ id: "msg_2", type: "message" }],
			},
			{ input: [{ role: "user", content: "Second" }] },
		)

		expect(
			state.expandRequestBody({
				previous_response_id: "resp_1",
				input: [],
			}),
		).toMatchObject({ previous_response_id: "resp_1", input: [] })
		expect(
			state.expandRequestBody({
				previous_response_id: "resp_2",
				input: [],
			}).previous_response_id,
		).toBeUndefined()
		expect(
			state.expandRequestBody({
				input: [{ type: "item_reference", id: "msg_1" }],
			}).input,
		).toEqual([{ type: "item_reference", id: "msg_1" }])
		expect(
			state.expandRequestBody({
				input: [{ type: "item_reference", id: "msg_2" }],
			}).input,
		).toEqual([{ id: "msg_2", type: "message" }])
	})

	test("rejects invalid cache bounds", () => {
		expect(() => new CodexResponsesState({ maxResponses: 0 })).toThrow(
			"maxResponses must be a positive integer.",
		)
		expect(() => new CodexResponsesState({ maxItems: 1.5 })).toThrow(
			"maxItems must be a positive integer.",
		)
	})
})
