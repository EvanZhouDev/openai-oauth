import { createOpenAIOAuth } from "@openai-oauth/ai-sdk"
import {
	convertToModelMessages,
	type ModelMessage,
	smoothStream,
	stepCountIs,
	streamText,
	type UIMessage,
} from "ai"
import {
	loadCatalogCached,
	pickDefaultModel,
	providerOptionsFor,
} from "../../lib/models"
import {
	errorMessage,
	providerCredentials,
	transportFromRequest,
} from "../../lib/openai"
import { buildSystemPrompt } from "../../lib/prompt"
import { createAgentTools } from "../../lib/tools"
import { workspaceOutline } from "../../lib/workspace"

export const maxDuration = 300

// How many tool round trips one turn may take before the agent is cut off.
const STEP_LIMIT = 32

/**
 * Codex runs with `store: false`, so nothing the model produced is kept
 * server-side. Replaying a reasoning item by its id therefore fails with
 * "Item with id 'rs_…' not found". Reasoning is still streamed to the browser
 * for display; it just never goes back upstream.
 */
const withoutReasoning = (messages: ModelMessage[]): ModelMessage[] =>
	messages.map((message) => {
		if (message.role !== "assistant" || !Array.isArray(message.content)) {
			return message
		}
		const content = message.content.filter((part) => part.type !== "reasoning")
		return content.length === message.content.length
			? message
			: ({ ...message, content } as ModelMessage)
	})

type ChatRequestBody = {
	messages?: UIMessage[]
	sessionId?: string
	model?: string
	roleId?: string
	customInstructions?: string
	reasoningEffort?: string
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
	if (!sessionId || !Array.isArray(body.messages)) {
		return Response.json(
			{ error: "`sessionId` and `messages` are required." },
			{ status: 400 },
		)
	}

	let openai: ReturnType<typeof createOpenAIOAuth>
	try {
		openai = createOpenAIOAuth(providerCredentials(request))
	} catch (error) {
		return Response.json({ error: errorMessage(error) }, { status: 401 })
	}

	// The catalog tells us which options this model accepts. If the client never
	// managed to load it, the server resolves a model itself rather than failing.
	const catalog = await loadCatalogCached(transportFromRequest(request))
	const modelId =
		body.model?.trim() ||
		(catalog ? pickDefaultModel(catalog.models) : undefined)

	if (!modelId) {
		return Response.json(
			{
				error:
					"No model available yet. The model list could not be loaded from your ChatGPT account — reload the page, and check that the account is signed in.",
			},
			{ status: 503 },
		)
	}

	const modelInfo = catalog?.models.find((model) => model.id === modelId)
	const providerOptions = providerOptionsFor(
		modelInfo,
		body.reasoningEffort,
		body.verbosity,
	)

	const outline = await workspaceOutline(sessionId).catch(() => "(empty)")
	const system = buildSystemPrompt({
		roleId: body.roleId,
		customInstructions: body.customInstructions,
		workspaceOutline: outline,
		sessionId,
		modelId,
	})

	const result = streamText({
		model: openai(modelId),
		system,
		messages: withoutReasoning(await convertToModelMessages(body.messages)),
		tools: createAgentTools({
			sessionId,
			provider: openai,
			signal: request.signal,
		}),
		stopWhen: stepCountIs(STEP_LIMIT),
		// Later steps in the same turn carry the earlier steps' reasoning, which
		// hits the same stateless-replay error, so strip it there too.
		prepareStep: ({ messages }) => ({ messages: withoutReasoning(messages) }),
		abortSignal: request.signal,
		providerOptions,
		experimental_transform: smoothStream({ delayInMs: 12, chunking: "word" }),
		onError: ({ error }) => {
			console.error(`[agent] stream error (${modelId}):`, errorMessage(error))
		},
	})

	return result.toUIMessageStreamResponse({
		sendReasoning: true,
		onError: (error) => errorMessage(error),
		// Tells the client when a turn ended because it ran out of steps rather
		// than because the agent was finished.
		messageMetadata: ({ part }) =>
			part.type === "finish" && part.finishReason === "tool-calls"
				? { stoppedAtStepLimit: STEP_LIMIT }
				: undefined,
		headers: {
			// Hosted proxies (Replit, nginx) buffer streams unless told not to,
			// which makes a working answer look like it hung.
			"cache-control": "no-cache, no-transform",
			"x-accel-buffering": "no",
		},
	})
}
