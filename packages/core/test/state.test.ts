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

	test("shares prior history across response branches", () => {
		const state = new CodexResponsesState()
		state.rememberResponse(
			{
				id: "resp_1",
				output: [{ id: "msg_1", type: "message", content: "Root reply" }],
			},
			{ input: [{ role: "user", content: "Root" }] },
		)
		state.rememberResponse(
			{
				id: "resp_2",
				output: [{ id: "msg_2", type: "message", content: "Left reply" }],
			},
			{
				previous_response_id: "resp_1",
				input: [{ role: "user", content: "Left" }],
			},
		)
		state.rememberResponse(
			{
				id: "resp_3",
				output: [{ id: "msg_3", type: "message", content: "Right reply" }],
			},
			{
				previous_response_id: "resp_1",
				input: [{ role: "user", content: "Right" }],
			},
		)

		expect(
			state.expandRequestBody({
				previous_response_id: "resp_2",
				input: [{ role: "user", content: "Continue left" }],
			}).input,
		).toEqual([
			{ role: "user", content: "Root" },
			{ id: "msg_1", type: "message", content: "Root reply" },
			{ role: "user", content: "Left" },
			{ id: "msg_2", type: "message", content: "Left reply" },
			{ role: "user", content: "Continue left" },
		])
		expect(
			state.expandRequestBody({
				previous_response_id: "resp_3",
				input: [{ role: "user", content: "Continue right" }],
			}).input,
		).toEqual([
			{ role: "user", content: "Root" },
			{ id: "msg_1", type: "message", content: "Root reply" },
			{ role: "user", content: "Right" },
			{ id: "msg_3", type: "message", content: "Right reply" },
			{ role: "user", content: "Continue right" },
		])
	})

	test("keeps ancestor data reachable after its response ID is evicted", () => {
		const state = new CodexResponsesState({ maxResponses: 1 })
		state.rememberResponse(
			{
				id: "resp_1",
				output: [{ id: "msg_1", type: "message", content: "First reply" }],
			},
			{ input: [{ role: "user", content: "First" }] },
		)
		state.rememberResponse(
			{
				id: "resp_2",
				output: [{ id: "msg_2", type: "message", content: "Second reply" }],
			},
			{
				previous_response_id: "resp_1",
				input: [{ role: "user", content: "Second" }],
			},
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
			}).input,
		).toEqual([
			{ role: "user", content: "First" },
			{ id: "msg_1", type: "message", content: "First reply" },
			{ role: "user", content: "Second" },
			{ id: "msg_2", type: "message", content: "Second reply" },
		])
	})

	test("captures the prepared parent after its lookup ID is evicted", () => {
		const state = new CodexResponsesState({ maxResponses: 1 })
		state.rememberResponse(
			{
				id: "resp_1",
				output: [{ id: "msg_1", type: "message", content: "First reply" }],
			},
			{ input: [{ role: "user", content: "First" }] },
		)
		const secondRequest = {
			previous_response_id: "resp_1",
			input: [{ role: "user", content: "Second" }],
		}
		state.expandRequestBody(secondRequest)
		state.rememberResponse(
			{ id: "unrelated", output: [] },
			{ input: [{ role: "user", content: "Unrelated" }] },
		)
		state.rememberResponse(
			{
				id: "resp_2",
				output: [{ id: "msg_2", type: "message", content: "Second reply" }],
			},
			secondRequest,
		)

		expect(
			state.expandRequestBody({
				previous_response_id: "resp_2",
				input: [],
			}).input,
		).toEqual([
			{ role: "user", content: "First" },
			{ id: "msg_1", type: "message", content: "First reply" },
			{ role: "user", content: "Second" },
			{ id: "msg_2", type: "message", content: "Second reply" },
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

	test("waits only for captures required by the request", async () => {
		let resolveRequired: (() => void) | undefined
		const required = new Promise<void>((resolve) => {
			resolveRequired = resolve
		})
		const unrelated = new Promise<void>(() => {})
		const state = new CodexResponsesState()
		state.registerPendingResponse("resp_required", required)
		state.registerPendingResponse("resp_unrelated", unrelated)

		let settled = false
		const waiting = state
			.waitForRequiredState({
				previous_response_id: "resp_required",
				input: [],
			})
			.then(() => {
				settled = true
			})
		await Promise.resolve()
		expect(settled).toBe(false)

		resolveRequired?.()
		await waiting
		expect(settled).toBe(true)
	})

	test("waits for the capture associated with a referenced item", async () => {
		let resolveRequired: (() => void) | undefined
		const required = new Promise<void>((resolve) => {
			resolveRequired = resolve
		})
		const state = new CodexResponsesState()
		state.registerPendingItem("item_required", required)

		let settled = false
		const waiting = state
			.waitForRequiredState({
				input: [{ type: "item_reference", id: "item_required" }],
			})
			.then(() => {
				settled = true
			})
		await Promise.resolve()
		expect(settled).toBe(false)

		resolveRequired?.()
		await waiting
		expect(settled).toBe(true)
	})

	test("does not block an unknown item reference on an unrelated capture", async () => {
		const unrelated = new Promise<void>(() => {})
		const state = new CodexResponsesState()
		state.registerPendingResponse("resp_unrelated", unrelated)

		await expect(
			state.waitForRequiredState({
				input: [{ type: "item_reference", id: "item_unknown" }],
			}),
		).resolves.toBeUndefined()
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
