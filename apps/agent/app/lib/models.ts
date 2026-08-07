import type { OpenAIOAuthTransport } from "@openai-oauth/core"

const CODEX_REGISTRY_URL = "https://registry.npmjs.org/@openai/codex/latest"
const FALLBACK_CODEX_VERSION = "0.144.1"
const VERSION_CACHE_TTL_MS = 60 * 60 * 1000

export type AgentModel = {
	id: string
	label: string
	description: string
	group: "standard" | "experimental"
	experimental: boolean
	supportedInApi: boolean
	reasoning: boolean
	defaultReasoningEffort?: string
	/** Effort levels this model actually accepts, straight from the catalog. */
	reasoningLevels: string[]
	defaultReasoningSummary?: string
	supportsVerbosity: boolean
	plans: string[]
	visibility?: string
}

export type ModelCatalog = {
	models: AgentModel[]
	clientVersion: string
	source: "codex-catalog" | "openai-compatible" | "fallback"
	fetchedAt: number
}

let cachedVersion: string | undefined
let cachedVersionExpiresAt = 0

/**
 * The Codex model list is keyed by client version: the server decides what a
 * client of that version may see, so this tracks the latest published Codex.
 */
export const resolveCodexClientVersion = async (): Promise<string> => {
	if (process.env.CODEX_CLIENT_VERSION) {
		return process.env.CODEX_CLIENT_VERSION
	}
	if (cachedVersion && Date.now() < cachedVersionExpiresAt) {
		return cachedVersion
	}
	try {
		const response = await fetch(CODEX_REGISTRY_URL, {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(8_000),
		})
		if (response.ok) {
			const payload = (await response.json()) as { version?: unknown }
			const version =
				typeof payload.version === "string"
					? payload.version.match(/\b\d+\.\d+\.\d+\b/)?.[0]
					: undefined
			if (version) {
				cachedVersion = version
				cachedVersionExpiresAt = Date.now() + VERSION_CACHE_TTL_MS
				return version
			}
		}
	} catch {
		// Fall through to the pinned version.
	}
	cachedVersion = FALLBACK_CODEX_VERSION
	cachedVersionExpiresAt = Date.now() + VERSION_CACHE_TTL_MS
	return FALLBACK_CODEX_VERSION
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const titleCase = (value: string): string =>
	value.charAt(0).toUpperCase() + value.slice(1)

const ACRONYMS = new Set(["api", "hd", "sfx", "tts", "ui", "vl"])

/**
 * `gpt-5.4-codex` reads as "GPT-5.4 Codex": the family keeps its hyphen to the
 * version number, everything after it becomes a word.
 */
export const prettyModelLabel = (slug: string): string => {
	const parts = slug.split(/[-_]/).filter((part) => part.length > 0)
	const words: string[] = []

	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index] as string

		if (/^gpt$/i.test(part)) {
			const version = parts[index + 1]
			if (version && /^\d[\d.]*$/.test(version)) {
				words.push(`GPT-${version}`)
				index += 1
				continue
			}
			words.push("GPT")
			continue
		}

		if (/^o\d/i.test(part) || /^\d/.test(part)) {
			words.push(part)
			continue
		}
		if (ACRONYMS.has(part.toLowerCase())) {
			words.push(part.toUpperCase())
			continue
		}
		words.push(titleCase(part))
	}

	return words.join(" ")
}

const describeModel = (model: AgentModel): string => {
	const traits: string[] = []
	if (/codex/i.test(model.id)) {
		traits.push("Tuned for coding and agentic work")
	} else if (/mini|nano|flash/i.test(model.id)) {
		traits.push("Fast and lightweight")
	} else if (/pro|max|high/i.test(model.id)) {
		traits.push("Deepest reasoning, slowest")
	} else {
		traits.push("Balanced everyday model")
	}
	if (model.experimental) {
		traits.push(
			model.visibility === "hide"
				? "hidden from the public list"
				: "not publicly listed",
		)
	}
	if (!model.supportedInApi) {
		traits.push("may not accept API requests")
	}
	return traits.join(" · ")
}

const toAgentModel = (raw: Record<string, unknown>): AgentModel | null => {
	const id = typeof raw.slug === "string" ? raw.slug : undefined
	if (!id || /image|audio|tts|whisper|embed|moderation/i.test(id)) {
		return null
	}

	const visibility =
		typeof raw.visibility === "string" ? raw.visibility : undefined
	const supportedInApi = raw.supported_in_api !== false
	// The catalog marks models "list" (public) or "hide". Hidden usually means
	// superseded rather than upcoming, so group them without promising either.
	const experimental =
		(visibility !== undefined && visibility !== "list") ||
		!supportedInApi ||
		/experimental|preview|alpha|beta|internal|canary/i.test(id)

	// The catalog lists levels either as plain strings or as {effort, description}.
	const reasoningLevels = Array.isArray(raw.supported_reasoning_levels)
		? raw.supported_reasoning_levels
				.map((level) =>
					typeof level === "string"
						? level
						: isRecord(level) && typeof level.effort === "string"
							? level.effort
							: undefined,
				)
				.filter((level): level is string => level !== undefined)
		: []

	const model: AgentModel = {
		id,
		label: prettyModelLabel(id),
		description: "",
		group: experimental ? "experimental" : "standard",
		experimental,
		supportedInApi,
		reasoning: typeof raw.default_reasoning_level === "string",
		defaultReasoningEffort:
			typeof raw.default_reasoning_level === "string"
				? raw.default_reasoning_level
				: undefined,
		reasoningLevels,
		defaultReasoningSummary:
			typeof raw.default_reasoning_summary === "string"
				? raw.default_reasoning_summary
				: undefined,
		supportsVerbosity: raw.support_verbosity === true,
		plans: Array.isArray(raw.available_in_plans)
			? raw.available_in_plans.filter(
					(plan): plan is string => typeof plan === "string",
				)
			: [],
		visibility,
	}
	model.description = describeModel(model)
	return model
}

const sortModels = (models: AgentModel[]): AgentModel[] =>
	[...models].sort((left, right) => {
		if (left.group !== right.group) {
			return left.group === "standard" ? -1 : 1
		}
		const codexDelta =
			Number(/codex/i.test(right.id)) - Number(/codex/i.test(left.id))
		if (codexDelta !== 0) {
			return codexDelta
		}
		return right.id.localeCompare(left.id, "en", { numeric: true })
	})

/**
 * Reads the Codex catalog without the public-only filter, so models marked
 * `visibility: "hide"` are listed too. Nothing is hard coded: whatever OpenAI
 * serves this account and client version is what appears.
 */
export const fetchModelCatalog = async (
	transport: OpenAIOAuthTransport,
): Promise<ModelCatalog> => {
	const clientVersion = await resolveCodexClientVersion()

	try {
		const response = await transport.request(
			`/models?client_version=${encodeURIComponent(clientVersion)}`,
		)
		const body = await response.text()
		if (response.ok) {
			const parsed: unknown = JSON.parse(body)
			if (isRecord(parsed) && Array.isArray(parsed.models)) {
				const models = parsed.models
					.filter(isRecord)
					.map(toAgentModel)
					.filter((model): model is AgentModel => model !== null)
				if (models.length > 0) {
					return {
						models: sortModels(models),
						clientVersion,
						source: "codex-catalog",
						fetchedAt: Date.now(),
					}
				}
			}
		}
	} catch {
		// Fall back to the OpenAI-compatible listing below.
	}

	const response = await transport.request("/models")
	const body = await response.text()
	if (!response.ok) {
		// A reachable-but-unhappy endpoint should not leave the app unusable.
		if (response.status >= 500 || response.status === 404) {
			return fallbackCatalog(clientVersion)
		}
		throw new Error(
			(() => {
				try {
					const parsed: unknown = JSON.parse(body)
					if (isRecord(parsed) && isRecord(parsed.error)) {
						return String(parsed.error.message ?? "Failed to load models.")
					}
				} catch {}
				return body || "Failed to load models."
			})(),
		)
	}

	const parsed: unknown = JSON.parse(body)
	const data = isRecord(parsed) && Array.isArray(parsed.data) ? parsed.data : []
	const models = data
		.filter(isRecord)
		.map((entry) =>
			typeof entry.id === "string" ? toAgentModel({ slug: entry.id }) : null,
		)
		.filter((model): model is AgentModel => model !== null)

	if (models.length === 0) {
		return fallbackCatalog(clientVersion)
	}

	return {
		models: sortModels(models),
		clientVersion,
		source: "openai-compatible",
		fetchedAt: Date.now(),
	}
}

export const DEFAULT_MODEL_PREFERENCE = [
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-5.6-luna",
	"gpt-5.5",
	"gpt-5.4-codex",
	"gpt-5.4",
	"gpt-5.4-mini",
]

/**
 * Used only when the catalog cannot be reached, so the app still works instead
 * of showing an empty picker. These slugs and their capabilities come from the
 * model list shipped inside the Codex client itself.
 */
const FALLBACK_MODELS: Array<
	Partial<Record<string, unknown>> & { slug: string }
> = [
	{
		slug: "gpt-5.6-sol",
		visibility: "list",
		default_reasoning_level: "low",
		default_reasoning_summary: "none",
		support_verbosity: true,
		supported_reasoning_levels: [
			{ effort: "low" },
			{ effort: "medium" },
			{ effort: "high" },
			{ effort: "xhigh" },
			{ effort: "max" },
			{ effort: "ultra" },
		],
	},
	{
		slug: "gpt-5.6-terra",
		visibility: "list",
		default_reasoning_level: "medium",
		default_reasoning_summary: "none",
		support_verbosity: true,
		supported_reasoning_levels: [
			{ effort: "low" },
			{ effort: "medium" },
			{ effort: "high" },
			{ effort: "xhigh" },
		],
	},
	{
		slug: "gpt-5.6-luna",
		visibility: "list",
		default_reasoning_level: "medium",
		default_reasoning_summary: "none",
		support_verbosity: true,
		supported_reasoning_levels: [
			{ effort: "low" },
			{ effort: "medium" },
			{ effort: "high" },
		],
	},
	{
		slug: "gpt-5.5",
		visibility: "list",
		default_reasoning_level: "medium",
		default_reasoning_summary: "none",
		support_verbosity: true,
		supported_reasoning_levels: [
			{ effort: "low" },
			{ effort: "medium" },
			{ effort: "high" },
		],
	},
	{
		slug: "gpt-5.4",
		visibility: "hide",
		default_reasoning_level: "medium",
		default_reasoning_summary: "none",
		support_verbosity: true,
	},
	{
		slug: "gpt-5.4-mini",
		visibility: "hide",
		default_reasoning_level: "low",
		default_reasoning_summary: "none",
		support_verbosity: true,
	},
]

export const fallbackCatalog = (clientVersion: string): ModelCatalog => ({
	models: sortModels(
		FALLBACK_MODELS.map(toAgentModel).filter(
			(model): model is AgentModel => model !== null,
		),
	),
	clientVersion,
	source: "fallback",
	fetchedAt: Date.now(),
})

export const pickDefaultModel = (models: AgentModel[]): string | undefined => {
	for (const preferred of DEFAULT_MODEL_PREFERENCE) {
		if (models.some((model) => model.id === preferred)) {
			return preferred
		}
	}
	return models.find((model) => !model.experimental)?.id ?? models[0]?.id
}

type CachedCatalog = { catalog: ModelCatalog; expiresAt: number }
const CATALOG_TTL_MS = 5 * 60 * 1000
let cachedCatalog: CachedCatalog | undefined

/** The catalog, cached briefly, for callers that only need capability flags. */
export const loadCatalogCached = async (
	transport: OpenAIOAuthTransport,
): Promise<ModelCatalog | undefined> => {
	if (cachedCatalog && Date.now() < cachedCatalog.expiresAt) {
		return cachedCatalog.catalog
	}
	try {
		const catalog = await fetchModelCatalog(transport)
		cachedCatalog = { catalog, expiresAt: Date.now() + CATALOG_TTL_MS }
		return catalog
	} catch {
		return cachedCatalog?.catalog
	}
}

/**
 * Builds provider options a model will actually accept. Sending an effort it
 * does not advertise, or a reasoning summary when its default is "none", makes
 * the upstream reject the whole request.
 */
export const providerOptionsFor = (
	model: AgentModel | undefined,
	requestedEffort: string | undefined,
	requestedVerbosity: string | undefined,
): { openai: Record<string, string> } | undefined => {
	const options: Record<string, string> = {}

	if (
		requestedEffort &&
		model &&
		model.reasoningLevels.includes(requestedEffort)
	) {
		options.reasoningEffort = requestedEffort
	} else if (requestedEffort && model && model.reasoningLevels.length === 0) {
		// No advertised list: trust the catalog default instead of guessing.
		if (model.defaultReasoningEffort === requestedEffort) {
			options.reasoningEffort = requestedEffort
		}
	}

	if (
		model?.defaultReasoningSummary &&
		model.defaultReasoningSummary !== "none"
	) {
		options.reasoningSummary = model.defaultReasoningSummary
	}

	if (requestedVerbosity && model?.supportsVerbosity) {
		options.textVerbosity = requestedVerbosity
	}

	return Object.keys(options).length > 0 ? { openai: options } : undefined
}
