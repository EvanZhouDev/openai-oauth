export type EndpointId = "responses" | "chat-completions"

export type ReasoningEffort = "minimal" | "low" | "medium" | "high"

export type ToolCallStatus = "streaming" | "running" | "done" | "error"

export type ToolCallRecord = {
	callId: string
	name: string
	arguments: string
	status: ToolCallStatus
	result?: string
	error?: string
}

export type Usage = {
	input?: number
	output?: number
	reasoning?: number
	cached?: number
	total?: number
}

export type TurnMeta = {
	endpoint: EndpointId
	model: string
	stream: boolean
	rounds: number
	latencyMs?: number
	finishReason?: string
	usage?: Usage
}

/**
 * Conversation state is kept endpoint-neutral so a single thread can be
 * replayed against `/v1/responses` or `/v1/chat/completions`. Both endpoints
 * are stateless here, so the whole history is resent on every request.
 */
export type HistoryItem =
	| { kind: "user"; id: string; text: string }
	| {
			kind: "assistant"
			id: string
			text: string
			reasoning: string
			toolCalls: ToolCallRecord[]
			/**
			 * Verbatim `output` items from `/v1/responses`. Replaying them keeps
			 * encrypted reasoning attached across turns, which Codex needs to
			 * continue a reasoning chain.
			 */
			responsesItems?: unknown[]
			meta?: TurnMeta
	  }
	| {
			kind: "tool"
			id: string
			callId: string
			name: string
			output: string
	  }

export type InspectorEntry = {
	id: string
	at: number
	kind: "request" | "response" | "stream" | "tool" | "error"
	label: string
	payload: unknown
}

export type RunEvent =
	| { type: "request"; endpoint: EndpointId; url: string; body: unknown }
	| { type: "stream-event"; label: string; payload: unknown }
	| { type: "response"; label: string; payload: unknown }
	| { type: "assistant-start"; id: string }
	| { type: "text-delta"; delta: string }
	| { type: "reasoning-delta"; delta: string }
	| { type: "tool-call-start"; callId: string; name: string }
	| { type: "tool-args-delta"; callId: string; delta: string }
	| { type: "tool-call-end"; callId: string; name: string; args: string }
	| {
			type: "tool-result"
			callId: string
			name: string
			output: string
			error?: string
	  }
	| { type: "turn-meta"; meta: TurnMeta }
	| { type: "history"; items: HistoryItem[] }
	| { type: "error"; message: string }

export type RunOptions = {
	endpoint: EndpointId
	model: string
	stream: boolean
	reasoningEffort: ReasoningEffort
	toolsEnabled: boolean
	instructions: string
	history: HistoryItem[]
	signal: AbortSignal
}

export const MAX_TOOL_ROUNDS = 6
