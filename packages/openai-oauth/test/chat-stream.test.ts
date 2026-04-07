import { describe, expect, test, vi } from "vitest"

// Mock only streamText, keep the real tool/jsonSchema exports
vi.mock("ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ai")>()
	return {
		...actual,
		streamText: vi.fn(),
	}
})

import { streamText } from "ai"
import { streamChatCompletions } from "../src/chat-stream.js"
import type { ChatRequest } from "../src/types.js"

const mockedStreamText = vi.mocked(streamText)

/** Helper to create a fake fullStream async iterable from an array of parts. */
function fakeFullStream(parts: unknown[]) {
	return {
		fullStream: (async function* () {
			for (const part of parts) {
				yield part
			}
		})(),
	}
}

/** Parse all SSE data lines from a streaming response. */
async function collectSseData(response: Response): Promise<unknown[]> {
	const text = await response.text()
	return text
		.split("\n")
		.filter((line) => line.startsWith("data: "))
		.map((line) => line.slice(6))
		.filter((data) => data !== "[DONE]")
		.map((data) => JSON.parse(data))
}

/** Find SSE chunks that contain tool_calls in the delta. */
function findToolCallChunks(chunks: unknown[]): unknown[] {
	return chunks.filter(
		(chunk: any) => chunk.choices?.[0]?.delta?.tool_calls != null,
	)
}

const dummyProvider = (() => ({})) as any
const dummyLogContext = {
	requestId: "test-req",
	startedAt: Date.now(),
}

describe("streamChatCompletions", () => {
	test("emits tool call arguments from deltas when model streams them", async () => {
		mockedStreamText.mockReturnValue(
			fakeFullStream([
				{
					type: "tool-input-start",
					id: "call_1",
					toolName: "Read",
				},
				{
					type: "tool-input-delta",
					id: "call_1",
					delta: '{"file',
				},
				{
					type: "tool-input-delta",
					id: "call_1",
					delta: '_path":"/etc/hosts"}',
				},
				// tool-call also fires but should be skipped since deltas were emitted
				{
					type: "tool-call",
					toolCallId: "call_1",
					toolName: "Read",
					input: { file_path: "/etc/hosts" },
				},
				{
					type: "finish",
					finishReason: "tool-calls",
					totalUsage: { promptTokens: 10, completionTokens: 20 },
				},
			]) as any,
		)

		const request: ChatRequest = {
			model: "gpt-5.4",
			messages: [{ role: "user", content: "read /etc/hosts" }],
			tools: [
				{
					type: "function",
					function: {
						name: "Read",
						parameters: {
							type: "object",
							properties: { file_path: { type: "string" } },
						},
					},
				},
			],
		}

		const response = await streamChatCompletions(
			request,
			dummyProvider,
			dummyLogContext,
		)

		expect(response.status).toBe(200)

		const chunks = await collectSseData(response)
		const toolChunks = findToolCallChunks(chunks)

		// Should have 3 tool call chunks: start + 2 deltas (tool-call skipped)
		expect(toolChunks).toHaveLength(3)

		// First chunk: tool-input-start with name and empty arguments
		expect(toolChunks[0]).toMatchObject({
			choices: [
				{
					delta: {
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: { name: "Read", arguments: "" },
							},
						],
					},
				},
			],
		})

		// Remaining chunks: deltas with argument fragments
		const args = (toolChunks as any[])
			.slice(1)
			.map((c) => c.choices[0].delta.tool_calls[0].function.arguments)
			.join("")

		expect(args).toBe('{"file_path":"/etc/hosts"}')
	})

	test("emits tool call arguments from tool-call event when model skips deltas", async () => {
		// Simulates gpt-5.3-codex-spark behavior: no tool-input-delta events
		mockedStreamText.mockReturnValue(
			fakeFullStream([
				{
					type: "tool-input-start",
					id: "call_2",
					toolName: "Read",
				},
				// No tool-input-delta — model returns args in one shot
				{
					type: "tool-call",
					toolCallId: "call_2",
					toolName: "Read",
					input: { file_path: "/etc/hosts", offset: 0, limit: 1000 },
				},
				{
					type: "finish",
					finishReason: "tool-calls",
					totalUsage: { promptTokens: 10, completionTokens: 20 },
				},
			]) as any,
		)

		const request: ChatRequest = {
			model: "gpt-5.3-codex-spark",
			messages: [{ role: "user", content: "read /etc/hosts" }],
			tools: [
				{
					type: "function",
					function: {
						name: "Read",
						parameters: {
							type: "object",
							properties: {
								file_path: { type: "string" },
								offset: { type: "integer" },
								limit: { type: "integer" },
							},
						},
					},
				},
			],
		}

		const response = await streamChatCompletions(
			request,
			dummyProvider,
			dummyLogContext,
		)

		expect(response.status).toBe(200)

		const chunks = await collectSseData(response)
		const toolChunks = findToolCallChunks(chunks)

		// Should have 2 tool call chunks: start + complete args from tool-call
		expect(toolChunks).toHaveLength(2)

		// First chunk: tool-input-start
		expect(toolChunks[0]).toMatchObject({
			choices: [
				{
					delta: {
						tool_calls: [
							{
								id: "call_2",
								function: { name: "Read", arguments: "" },
							},
						],
					},
				},
			],
		})

		// Second chunk: complete arguments from tool-call fallback
		const args = (toolChunks[1] as any).choices[0].delta.tool_calls[0]
			.function.arguments
		expect(JSON.parse(args)).toEqual({
			file_path: "/etc/hosts",
			offset: 0,
			limit: 1000,
		})
	})
})
