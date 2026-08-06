import { createOpenAIOAuth } from "@openai-oauth/ai-sdk"
import { openaiCredentials } from "@openai-oauth/react/server"
import {
	convertToModelMessages,
	smoothStream,
	stepCountIs,
	streamText,
	type UIMessage,
} from "ai"
import { errorMessage } from "../../lib/openai"
import { buildSystemPrompt } from "../../lib/prompt"
import { createAgentTools } from "../../lib/tools"
import { workspaceOutline } from "../../lib/workspace"

export const maxDuration = 300

type ChatRequestBody = {
	messages?: UIMessage[]
	sessionId?: string
	model?: string
	roleId?: string
	customInstructions?: string
	reasoningEffort?: string
	supportsReasoning?: boolean
	verbosity?: "low" | "medium" | "high"
}

export async function POST(request: Request) {
	let body: ChatRequestBody
	try {
		body = (await request.json()) as ChatRequestBody
	} catch {
		return Response.json({ error: "Invalid request body." }, { status: 400 })
	}

	const sessionId = body.sessionId?.trim()
	const modelId = body.model?.trim()
	if (!sessionId || !modelId || !Array.isArray(body.messages)) {
		return Response.json(
			{ error: "`sessionId`, `model` and `messages` are required." },
			{ status: 400 },
		)
	}

	let openai: ReturnType<typeof createOpenAIOAuth>
	try {
		openai = createOpenAIOAuth(openaiCredentials(request))
	} catch (error) {
		return Response.json({ error: errorMessage(error) }, { status: 401 })
	}

	const outline = await workspaceOutline(sessionId).catch(() => "(empty)")
	const system = buildSystemPrompt({
		roleId: body.roleId,
		customInstructions: body.customInstructions,
		workspaceOutline: outline,
		sessionId,
		modelId,
	})

	const providerOptions =
		body.supportsReasoning === false
			? undefined
			: {
					openai: {
						...(body.reasoningEffort
							? { reasoningEffort: body.reasoningEffort }
							: {}),
						reasoningSummary: "auto",
						...(body.verbosity ? { textVerbosity: body.verbosity } : {}),
					},
				}

	const result = streamText({
		model: openai(modelId),
		system,
		messages: await convertToModelMessages(body.messages),
		tools: createAgentTools({
			sessionId,
			provider: openai,
			signal: request.signal,
		}),
		stopWhen: stepCountIs(32),
		abortSignal: request.signal,
		providerOptions,
		experimental_transform: smoothStream({ delayInMs: 12, chunking: "word" }),
		onError: ({ error }) => {
			console.error("[agent] stream error:", errorMessage(error))
		},
	})

	return result.toUIMessageStreamResponse({
		sendReasoning: true,
		onError: (error) => errorMessage(error),
	})
}
