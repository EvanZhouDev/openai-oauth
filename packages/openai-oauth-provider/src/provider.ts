import { OpenAIResponsesLanguageModel } from "@ai-sdk/openai/internal"
import {
	type LanguageModelV3,
	type LanguageModelV3Content,
	type LanguageModelV3FinishReason,
	type LanguageModelV3ResponseMetadata,
	type LanguageModelV3Usage,
	NoSuchModelError,
	type ProviderV3,
	type SharedV3ProviderMetadata,
	type SharedV3Warning,
} from "@ai-sdk/provider"
import { type FetchFunction, withUserAgentSuffix } from "@ai-sdk/provider-utils"
import {
	type CodexOAuthSettings,
	createCodexOAuthFetch,
	DEFAULT_CODEX_BASE_URL,
} from "../../openai-oauth-core/src/index.js"

export type OpenAIOAuthModelId = string

export type OpenAIOAuthProviderSettings = CodexOAuthSettings & {
	name?: string
}

type OpenAIConfig = {
	provider: string
	url: (options: { modelId: string; path: string }) => string
	headers: () => Record<string, string | undefined>
	fetch?: FetchFunction
	generateId?: () => string
	fileIdPrefixes?: readonly string[]
}

const emptyUsage = (): LanguageModelV3Usage => ({
	inputTokens: undefined,
	outputTokens: undefined,
	totalTokens: undefined,
})

const mergeProviderMetadata = (
	left: SharedV3ProviderMetadata | undefined,
	right: SharedV3ProviderMetadata | undefined,
): SharedV3ProviderMetadata | undefined => {
	if (left == null) return right
	if (right == null) return left

	const merged: SharedV3ProviderMetadata = { ...left }
	for (const [provider, value] of Object.entries(right)) {
		const existing = merged[provider]
		merged[provider] = existing == null ? value : { ...existing, ...value }
	}

	return merged
}

class CodexResponsesLanguageModel extends OpenAIResponsesLanguageModel {
	async doGenerate(
		options: Parameters<LanguageModelV3["doGenerate"]>[0],
	): Promise<Awaited<ReturnType<LanguageModelV3["doGenerate"]>>> {
		const streamResult = await super.doStream(options)
		const reader = streamResult.stream.getReader()

		const content: Array<LanguageModelV3Content> = []
		const warnings: Array<SharedV3Warning> = []
		const activeTextById = new Map<string, LanguageModelV3Content>()
		const activeReasoningById = new Map<string, LanguageModelV3Content>()

		let finishReason: LanguageModelV3FinishReason = "unknown"
		let usage: LanguageModelV3Usage = emptyUsage()
		let providerMetadata: SharedV3ProviderMetadata | undefined
		let responseMetadata: LanguageModelV3ResponseMetadata | undefined

		try {
			while (true) {
				const { value: part, done } = await reader.read()
				if (done) {
					break
				}

				switch (part.type) {
					case "stream-start": {
						warnings.push(...part.warnings)
						break
					}

					case "response-metadata": {
						responseMetadata = {
							id: part.id,
							timestamp: part.timestamp,
							modelId: part.modelId,
						}
						break
					}

					case "text-start": {
						const textPart: LanguageModelV3Content = {
							type: "text",
							text: "",
							providerMetadata: part.providerMetadata,
						}

						content.push(textPart)
						activeTextById.set(part.id, textPart)
						break
					}

					case "text-delta": {
						const existing = activeTextById.get(part.id)
						if (existing == null) {
							const textPart: LanguageModelV3Content = {
								type: "text",
								text: part.delta,
								providerMetadata: part.providerMetadata,
							}

							content.push(textPart)
							activeTextById.set(part.id, textPart)
						} else if (existing.type === "text") {
							existing.text += part.delta
							existing.providerMetadata = mergeProviderMetadata(
								existing.providerMetadata,
								part.providerMetadata,
							)
						}
						break
					}

					case "text-end": {
						const existing = activeTextById.get(part.id)
						if (existing?.type === "text") {
							existing.providerMetadata = mergeProviderMetadata(
								existing.providerMetadata,
								part.providerMetadata,
							)
							activeTextById.delete(part.id)
						}
						break
					}

					case "reasoning-start": {
						const reasoningPart: LanguageModelV3Content = {
							type: "reasoning",
							text: "",
							providerMetadata: part.providerMetadata,
						}

						content.push(reasoningPart)
						activeReasoningById.set(part.id, reasoningPart)
						break
					}

					case "reasoning-delta": {
						const existing = activeReasoningById.get(part.id)
						if (existing == null) {
							const reasoningPart: LanguageModelV3Content = {
								type: "reasoning",
								text: part.delta,
								providerMetadata: part.providerMetadata,
							}

							content.push(reasoningPart)
							activeReasoningById.set(part.id, reasoningPart)
						} else if (existing.type === "reasoning") {
							existing.text += part.delta
							existing.providerMetadata = mergeProviderMetadata(
								existing.providerMetadata,
								part.providerMetadata,
							)
						}
						break
					}

					case "reasoning-end": {
						const existing = activeReasoningById.get(part.id)
						if (existing?.type === "reasoning") {
							existing.providerMetadata = mergeProviderMetadata(
								existing.providerMetadata,
								part.providerMetadata,
							)
							activeReasoningById.delete(part.id)
						}
						break
					}

					case "tool-input-start":
					case "tool-input-delta":
					case "tool-input-end": {
						break
					}

					case "tool-call":
					case "tool-result":
					case "file":
					case "source": {
						content.push(part)
						break
					}

					case "finish": {
						finishReason = part.finishReason
						usage = part.usage
						providerMetadata = part.providerMetadata
						break
					}

					case "raw": {
						break
					}

					case "error": {
						throw part.error instanceof Error
							? part.error
							: new Error("Streaming request failed.", { cause: part.error })
					}

					default: {
						part satisfies never
					}
				}
			}
		} finally {
			reader.releaseLock()
		}

		const responseHeaders = streamResult.response?.headers
		const response =
			responseMetadata == null && responseHeaders == null
				? undefined
				: {
						...(responseMetadata ?? {}),
						...(responseHeaders == null ? {} : { headers: responseHeaders }),
					}

		return {
			content,
			finishReason,
			usage,
			providerMetadata,
			request: streamResult.request,
			response,
			warnings,
		}
	}
}

export interface OpenAIOAuthProvider extends ProviderV3 {
	(modelId: OpenAIOAuthModelId): LanguageModelV3
	languageModel(modelId: OpenAIOAuthModelId): LanguageModelV3
}

export const createOpenAIOAuth = (
	settings: OpenAIOAuthProviderSettings = {},
): OpenAIOAuthProvider => {
	const baseURL = settings.baseURL ?? DEFAULT_CODEX_BASE_URL
	const providerName = settings.name ?? "openai"
	const oauthFetch = createCodexOAuthFetch(settings)

	const config: OpenAIConfig = {
		provider: `${providerName}.responses`,
		url: ({ path }) => `${baseURL}${path}`,
		headers: () => withUserAgentSuffix({}, "oai-oauth/0.0.0"),
		fetch: oauthFetch,
		fileIdPrefixes: ["file-"],
	}

	const createModel = (modelId: OpenAIOAuthModelId) =>
		new CodexResponsesLanguageModel(modelId, config)

	const providerFn = (modelId: OpenAIOAuthModelId) => createModel(modelId)
	const specificationVersion: ProviderV3["specificationVersion"] = "v3"

	return Object.assign(providerFn, {
		specificationVersion,
		languageModel: createModel,
		embeddingModel: (modelId: string) => {
			throw new NoSuchModelError({ modelId, modelType: "embeddingModel" })
		},
		imageModel: (modelId: string) => {
			throw new NoSuchModelError({ modelId, modelType: "imageModel" })
		},
	})
}

export const openai = createOpenAIOAuth()
