import type { Server as HttpServer } from "node:http"
import type { CodexOAuthSettings } from "../../openai-oauth-core/src/index.js"

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| JsonObject
export type JsonObject = { [key: string]: JsonValue }

export type ToolOutputValue =
	| {
			type: "json"
			value: JsonValue
	  }
	| {
			type: "text"
			value: string
	  }

export type ChatToolDefinition = {
	type?: string
	function?: {
		name?: string
		description?: string
		parameters?: JsonObject
	}
}

export type ChatToolChoice =
	| "auto"
	| "none"
	| "required"
	| {
			type?: string
			function?: {
				name?: string
			}
	  }

export type ChatMessage = {
	role?: string
	content?: unknown
	tool_calls?: Array<{
		id?: string
		type?: string
		function?: {
			name?: string
			arguments?: string
		}
	}>
	tool_call_id?: string
}

export type ChatRequest = {
	model?: string
	messages?: ChatMessage[]
	stream?: boolean
	tools?: ChatToolDefinition[]
	tool_choice?: ChatToolChoice
	temperature?: number
	top_p?: number
	stop?: string | string[]
	max_tokens?: number
	parallel_tool_calls?: boolean
	reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high"
	response_format?:
		| {
				type?: "json_object"
		  }
		| {
				type?: "json_schema"
				json_schema?: {
					name?: string
					description?: string
					schema?: JsonObject
				}
		  }
}

export type ChatRequestSummary = {
	bodyKeys: string[]
	messageCount: number
	messageRoles: string[]
	model?: string
	reasoningEffort?: ChatRequest["reasoning_effort"]
	stream: boolean
	toolCount: number
}

type UsageLike = {
	inputTokens?: number
	outputTokens?: number
	totalTokens?: number
	reasoningTokens?: number
	cachedInputTokens?: number
}

export type OpenAIOAuthServerLogEvent =
	| ({
			type: "chat_request"
			requestId: string
			path: "/v1/chat/completions"
	  } & ChatRequestSummary)
	| {
			type: "chat_response"
			durationMs: number
			finishReason?: string
			path: "/v1/chat/completions"
			requestId: string
			status: number
			stream: boolean
			usage: UsageLike
	  }
	| {
			type: "chat_error"
			durationMs: number
			message: string
			path: "/v1/chat/completions"
			requestId: string
	  }

export const defaultOpenAIOAuthModels: readonly string[] = [
	"gpt-5.4",
	"gpt-5.3-codex",
	"gpt-5.3-codex-spark",
	"gpt-5.2",
	"gpt-5.1",
	"gpt-5.1-codex",
	"gpt-5.1-codex-max",
]

export type OpenAIOAuthServerOptions = Omit<
	CodexOAuthSettings,
	"responsesState"
> & {
	host?: string
	port?: number
	models?: string[]
	codexVersion?: string
	requestLogger?: (event: OpenAIOAuthServerLogEvent) => void
}

export type RunningOpenAIOAuthServer = {
	server: HttpServer
	host: string
	port: number
	url: string
	close: () => Promise<void>
}

export type ChatCompletionResultShape = {
	text: string
	finishReason: string
	toolCalls: Array<{
		toolCallId: string
		toolName: string
		input: unknown
	}>
	usage: UsageLike
}

export type { UsageLike }
