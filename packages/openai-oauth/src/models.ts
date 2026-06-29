import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { CodexOAuthClient } from "@openai-oauth/core"

const MODELS_CACHE_TTL_MS = 5 * 60 * 1000
const CODEX_VERSION_CACHE_TTL_MS = 60 * 60 * 1000
const REGISTRY_URL = "https://registry.npmjs.org/@openai/codex/latest"
const FALLBACK_CODEX_CLIENT_VERSION = "0.111.0"

type ModelCatalogEntry = {
	slug?: unknown
}

type ModelCatalogResponse = {
	models?: ModelCatalogEntry[]
	error?: {
		message?: unknown
	}
	detail?: unknown
}

type RegistryPackageResponse = {
	version?: unknown
}

type ModelResolver = () => Promise<string[]>

type RunCommand = (
	file: string,
	args: string[],
) => Promise<{ stdout: string; stderr: string }>

type FetchLike = typeof fetch

type ModelResolverDependencies = {
	codexVersion?: string
	fetchImpl?: FetchLike
	onWarning?: (message: string) => void
	runCommand?: RunCommand
}

const execFileAsync = promisify(execFile)

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const uniqueStrings = (values: string[]): string[] => {
	const seen = new Set<string>()
	const result: string[] = []

	for (const value of values) {
		if (!seen.has(value)) {
			seen.add(value)
			result.push(value)
		}
	}

	return result
}

const normalizeVersion = (value: string | undefined): string | undefined => {
	if (typeof value !== "string") {
		return undefined
	}

	const match = value.trim().match(/\b\d+\.\d+\.\d+\b/)
	return match?.[0]
}

let cachedCodexClientVersion: string | undefined
let codexClientVersionCacheExpiresAt = 0
let inflightCodexClientVersion: Promise<string> | undefined

const resolveLocalCodexClientVersion = async (
	runCommand: RunCommand,
): Promise<string | undefined> => {
	try {
		const { stdout, stderr } = await runCommand("codex", ["--version"])
		return normalizeVersion(stdout) ?? normalizeVersion(stderr)
	} catch {
		return undefined
	}
}

const resolveRemoteCodexClientVersion = async (
	fetchImpl: FetchLike,
): Promise<string | undefined> => {
	try {
		const response = await fetchImpl(REGISTRY_URL, {
			headers: {
				accept: "application/json",
			},
		})

		if (!response.ok) {
			return undefined
		}

		const parsed = (await response.json()) as RegistryPackageResponse
		return typeof parsed.version === "string"
			? normalizeVersion(parsed.version)
			: undefined
	} catch {
		return undefined
	}
}

export const resolveCodexClientVersion = async (
	dependencies: ModelResolverDependencies = {},
): Promise<string> => {
	if (
		typeof dependencies.codexVersion === "string" &&
		dependencies.codexVersion.trim().length > 0
	) {
		return dependencies.codexVersion.trim()
	}

	const now = Date.now()
	if (cachedCodexClientVersion && now < codexClientVersionCacheExpiresAt) {
		return cachedCodexClientVersion
	}

	if (inflightCodexClientVersion) {
		return inflightCodexClientVersion
	}

	const runCommand = dependencies.runCommand ?? execFileAsync
	const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch

	inflightCodexClientVersion = (async () => {
		const localVersion = await resolveLocalCodexClientVersion(runCommand)
		if (localVersion) {
			cachedCodexClientVersion = localVersion
			codexClientVersionCacheExpiresAt = Date.now() + CODEX_VERSION_CACHE_TTL_MS
			inflightCodexClientVersion = undefined
			return localVersion
		}

		const remoteVersion = await resolveRemoteCodexClientVersion(fetchImpl)
		if (remoteVersion) {
			cachedCodexClientVersion = remoteVersion
			codexClientVersionCacheExpiresAt = Date.now() + CODEX_VERSION_CACHE_TTL_MS
			inflightCodexClientVersion = undefined
			return remoteVersion
		}

		cachedCodexClientVersion = FALLBACK_CODEX_CLIENT_VERSION
		codexClientVersionCacheExpiresAt = Date.now() + CODEX_VERSION_CACHE_TTL_MS
		dependencies.onWarning?.(
			`Could not determine the Codex API version automatically. Falling back to ${FALLBACK_CODEX_CLIENT_VERSION}. Pass a version explicitly with --codex-version if you need to override it.`,
		)
		inflightCodexClientVersion = undefined
		return FALLBACK_CODEX_CLIENT_VERSION
	})().catch((error) => {
		inflightCodexClientVersion = undefined
		throw error
	})

	return inflightCodexClientVersion
}

export const resetCodexClientVersionCache = (): void => {
	cachedCodexClientVersion = undefined
	codexClientVersionCacheExpiresAt = 0
	inflightCodexClientVersion = undefined
}

const toUpstreamErrorMessage = (bodyText: string | undefined): string => {
	if (typeof bodyText !== "string" || bodyText.length === 0) {
		return "Failed to load models from Codex."
	}

	try {
		const parsed = JSON.parse(bodyText) as ModelCatalogResponse
		if (typeof parsed.detail === "string" && parsed.detail.length > 0) {
			return parsed.detail
		}
		if (isRecord(parsed.error) && typeof parsed.error.message === "string") {
			return parsed.error.message
		}
	} catch {}

	return bodyText
}

const fetchAvailableModels = async (
	client: CodexOAuthClient,
	dependencies: ModelResolverDependencies = {},
): Promise<string[]> => {
	const clientVersion = await resolveCodexClientVersion(dependencies)
	const response = await client.request(
		`/models?client_version=${encodeURIComponent(clientVersion)}`,
	)
	const bodyText = await response.text()

	if (!response.ok) {
		throw new Error(toUpstreamErrorMessage(bodyText))
	}

	let parsed: ModelCatalogResponse
	try {
		parsed = JSON.parse(bodyText) as ModelCatalogResponse
	} catch {
		throw new Error("Codex returned an invalid models response.")
	}

	if (!Array.isArray(parsed.models)) {
		throw new Error("Codex returned a malformed models response.")
	}

	const models = uniqueStrings(
		parsed.models
			.map((model) => model.slug)
			.filter(
				(slug): slug is string => typeof slug === "string" && slug.length > 0,
			),
	)

	if (models.length === 0) {
		throw new Error("Codex returned an empty models list.")
	}

	return models
}

export const resolveOpenAIOAuthModels = async (
	client: CodexOAuthClient,
	configuredModels: string[] | undefined,
	dependencies: ModelResolverDependencies = {},
): Promise<string[]> => {
	if (Array.isArray(configuredModels) && configuredModels.length > 0) {
		return uniqueStrings(configuredModels)
	}

	return fetchAvailableModels(client, dependencies)
}

export const createModelResolver = (
	client: CodexOAuthClient,
	configuredModels: string[] | undefined,
	dependencies: ModelResolverDependencies = {},
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

		inflight = resolveOpenAIOAuthModels(client, configuredModels, dependencies)
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
