import type { CodexOAuthClient } from "@openai-oauth/core"

const MODELS_CACHE_TTL_MS = 5 * 60 * 1000

type ModelResolver = () => Promise<string[]>

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const uniqueStrings = (values: string[]): string[] => [...new Set(values)]

const modelListError = (bodyText: string): string => {
	try {
		const parsed = JSON.parse(bodyText)
		if (
			isRecord(parsed) &&
			isRecord(parsed.error) &&
			typeof parsed.error.message === "string"
		) {
			return parsed.error.message
		}
	} catch {}

	return bodyText || "Failed to load models from Codex."
}

const readModelList = async (client: CodexOAuthClient): Promise<string[]> => {
	const response = await client.request("/models")
	const bodyText = await response.text()

	if (!response.ok) {
		throw new Error(modelListError(bodyText))
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(bodyText)
	} catch {
		throw new Error("Codex returned an invalid models response.")
	}

	if (!isRecord(parsed) || !Array.isArray(parsed.data)) {
		throw new Error("Codex returned a malformed models response.")
	}

	const models = uniqueStrings(
		parsed.data
			.map((model) => (isRecord(model) ? model.id : undefined))
			.filter((id): id is string => typeof id === "string" && id.length > 0),
	)
	if (models.length === 0) {
		throw new Error("Codex returned an empty models list.")
	}

	return models
}

export const resolveOpenAIOAuthModels = async (
	client: CodexOAuthClient,
	configuredModels: string[] | undefined,
): Promise<string[]> =>
	Array.isArray(configuredModels) && configuredModels.length > 0
		? uniqueStrings(configuredModels)
		: readModelList(client)

export const createModelResolver = (
	client: CodexOAuthClient,
	configuredModels: string[] | undefined,
): ModelResolver => {
	let cachedModels: string[] | undefined
	let cacheExpiresAt = 0
	let inflight: Promise<string[]> | undefined

	return async () => {
		const now = Date.now()
		if (cachedModels && now < cacheExpiresAt) {
			return [...cachedModels]
		}

		if (inflight) {
			return [...(await inflight)]
		}

		inflight = resolveOpenAIOAuthModels(client, configuredModels)
			.then((models) => {
				cachedModels = models
				cacheExpiresAt = Date.now() + MODELS_CACHE_TTL_MS
				inflight = undefined
				return models
			})
			.catch((error) => {
				inflight = undefined
				throw error
			})

		return [...(await inflight)]
	}
}
