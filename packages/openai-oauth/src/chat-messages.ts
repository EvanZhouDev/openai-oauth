import { jsonSchema, type ModelMessage, tool } from "ai"
import { isJsonValue, isRecord } from "./shared.js"
import type {
	ChatMessage,
	ChatToolChoice,
	ChatToolDefinition,
	JsonValue,
	ToolOutputValue,
} from "./types.js"

const toJsonToolOutput = (value: JsonValue): ToolOutputValue => ({
	type: "json",
	value,
})

const toTextToolOutput = (value: string): ToolOutputValue => ({
	type: "text",
	value,
})

const coerceToolOutput = (content: unknown): ToolOutputValue => {
	if (typeof content === "string") {
		try {
			const parsed: JsonValue = JSON.parse(content)
			return toJsonToolOutput(parsed)
		} catch {
			return toTextToolOutput(content)
		}
	}

	if (isJsonValue(content)) {
		return toJsonToolOutput(content)
	}

	return toTextToolOutput(String(content ?? ""))
}

const parseToolArguments = (value: string | undefined): unknown => {
	if (typeof value !== "string" || value.length === 0) {
		return {}
	}

	try {
		return JSON.parse(value)
	} catch {
		return value
	}
}

const toTextParts = (content: unknown): string => {
	if (typeof content === "string") {
		return content
	}

	if (!Array.isArray(content)) {
		return ""
	}

	return content
		.map((item) => {
			if (!isRecord(item)) {
				return ""
			}

			return item.type === "text" && typeof item.text === "string"
				? item.text
				: ""
		})
		.filter((item) => item.length > 0)
		.join("")
}

const DATA_IMAGE_RE = /^data:(image\/[^;]+);base64,(.+)$/

const toUserContent = (content: unknown) => {
	if (typeof content === "string") {
		return content
	}

	if (!Array.isArray(content)) {
		return ""
	}

	const parts: Array<
		| { type: "text"; text: string }
		| { type: "image"; image: URL; mediaType?: string }
		| { type: "file"; data: string; mediaType: string }
	> = []

	for (const item of content) {
		if (!isRecord(item) || typeof item.type !== "string") {
			continue
		}

		if (item.type === "text" && typeof item.text === "string") {
			parts.push({ type: "text", text: item.text })
			continue
		}

		if (
			item.type === "image_url" &&
			isRecord(item.image_url) &&
			typeof item.image_url.url === "string"
		) {
			const dataMatch = item.image_url.url.match(DATA_IMAGE_RE)
			if (dataMatch) {
				parts.push({
					type: "file",
					data: dataMatch[2],
					mediaType: dataMatch[1],
				})
			} else {
				try {
					parts.push({ type: "image", image: new URL(item.image_url.url) })
				} catch {}
			}
		}
	}

	return parts.length > 0 ? parts : ""
}

export const toModelMessages = (messages: ChatMessage[]): ModelMessage[] => {
	const modelMessages: ModelMessage[] = []
	const toolNamesById = new Map<string, string>()

	for (const message of messages) {
		switch (message.role) {
			case "system":
			case "developer":
				modelMessages.push({
					role: "system",
					content: toTextParts(message.content),
				})
				break
			case "user":
				modelMessages.push({
					role: "user",
					content: toUserContent(message.content),
				})
				break
			case "assistant": {
				const parts: Array<
					| { type: "text"; text: string }
					| {
							type: "tool-call"
							toolCallId: string
							toolName: string
							input: unknown
					  }
				> = []

				const text = toTextParts(message.content)
				if (text.length > 0) {
					parts.push({ type: "text", text })
				}

				for (const toolCall of message.tool_calls ?? []) {
					const toolCallId = toolCall.id
					const toolName = toolCall.function?.name
					if (
						typeof toolCallId !== "string" ||
						typeof toolName !== "string" ||
						toolName.length === 0
					) {
						continue
					}

					toolNamesById.set(toolCallId, toolName)
					parts.push({
						type: "tool-call",
						toolCallId,
						toolName,
						input: parseToolArguments(toolCall.function?.arguments),
					})
				}

				modelMessages.push({
					role: "assistant",
					content:
						parts.length === 1 && parts[0]?.type === "text"
							? parts[0].text
							: parts,
				})
				break
			}
			case "tool":
				if (typeof message.tool_call_id !== "string") {
					break
				}

				modelMessages.push({
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: message.tool_call_id,
							toolName: toolNamesById.get(message.tool_call_id) ?? "tool",
							output: coerceToolOutput(message.content),
						},
					],
				})
				break
		}
	}

	return modelMessages
}

export const createToolSet = (tools: ChatToolDefinition[] | undefined) => {
	if (!Array.isArray(tools)) {
		return {}
	}

	const entries: Array<[string, ReturnType<typeof tool>]> = []
	for (const definition of tools) {
		const toolName = definition.function?.name
		if (
			definition.type !== "function" ||
			typeof toolName !== "string" ||
			toolName.length === 0
		) {
			continue
		}

		entries.push([
			toolName,
			tool({
				description: definition.function?.description,
				inputSchema: jsonSchema(
					definition.function?.parameters ?? {
						type: "object",
						properties: {},
						additionalProperties: true,
					},
				),
			}),
		])
	}

	return Object.fromEntries(entries)
}

export const toToolChoice = (
	toolChoice: ChatToolChoice | undefined,
):
	| undefined
	| "auto"
	| "none"
	| "required"
	| { type: "tool"; toolName: string } => {
	if (
		toolChoice == null ||
		toolChoice === "auto" ||
		toolChoice === "none" ||
		toolChoice === "required"
	) {
		return toolChoice
	}

	if (
		toolChoice.type === "function" &&
		typeof toolChoice.function?.name === "string"
	) {
		return {
			type: "tool",
			toolName: toolChoice.function.name,
		}
	}

	return "auto"
}
