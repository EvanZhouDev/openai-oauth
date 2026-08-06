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
	supportsVerbosity: boolean
	plans: string[]
	visibility?: string
}

export type ModelCatalog = {
	models: AgentModel[]
	clientVersion: string
	source: "codex-catalog" | "openai-compatible"
	fetchedAt: number
}

let cachedVersion: string | undefined
let cachedVersionExpiresAt = 0

/**
 * The Codex model list is keyed by client version — newer Codex releases are
 * shown newer models, including ones OpenAI is still testing.
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

export const prettyModelLabel = (slug: string): string =>
	slug
		.split(/[-_]/)
		.map((part) => {
			if (/^gpt/i.test(part)) {
				return part.replace(/^gpt/i, "GPT")
			}
			if (/^o\d/i.test(part) || /^\d/.test(part)) {
				return part
			}
			if (part.length <= 3 && /^[a-z]+$/.test(part)) {
				return part.toUpperCase()
			}
			return titleCase(part)
		})
		.join(" ")

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
		traits.push("not publicly listed")
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
	const experimental =
		(visibility !== undefined && visibility !== "list") ||
		!supportedInApi ||
		/experimental|preview|alpha|beta|internal|canary|test/i.test(id)

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
 * Reads the full Codex catalog — including models whose visibility keeps them
 * out of the public list. Nothing here is hard coded, so a model OpenAI ships
 * tomorrow shows up the next time the page is loaded.
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
		throw new Error("The account returned an empty model list.")
	}

	return {
		models: sortModels(models),
		clientVersion,
		source: "openai-compatible",
		fetchedAt: Date.now(),
	}
}

export const DEFAULT_MODEL_PREFERENCE = [
	"gpt-5.4-codex",
	"gpt-5.3-codex",
	"gpt-5.2-codex",
	"gpt-5.1-codex",
	"gpt-5-codex",
	"gpt-5.4",
	"gpt-5.4-mini",
]

export const pickDefaultModel = (models: AgentModel[]): string | undefined => {
	for (const preferred of DEFAULT_MODEL_PREFERENCE) {
		if (models.some((model) => model.id === preferred)) {
			return preferred
		}
	}
	return models.find((model) => !model.experimental)?.id ?? models[0]?.id
}
