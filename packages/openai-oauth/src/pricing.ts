export type ModelPricing = {
	promptPerToken: number
	completionPerToken: number
	cachedPerToken: number
}

export type TokenUsage = {
	prompt_tokens?: number
	input_tokens?: number
	completion_tokens?: number
	output_tokens?: number
	cached_tokens?: number
	cached_input_tokens?: number
}

const FALLBACK_PRICING: Record<string, ModelPricing> = {
	"gpt-6-luna": {
		promptPerToken: 0.0000001,
		completionPerToken: 0.0000005,
		cachedPerToken: 0.00000001,
	},
	"gpt-6.1-sol": {
		promptPerToken: 0.000002,
		completionPerToken: 0.00001,
		cachedPerToken: 0.0000001,
	},
	"gpt-6-sol": {
		promptPerToken: 0.000002,
		completionPerToken: 0.00001,
		cachedPerToken: 0.0000002,
	},
	"gpt-5.6-luna": {
		promptPerToken: 0.0000002,
		completionPerToken: 0.0000012,
		cachedPerToken: 0.00000002,
	},
	"gpt-5.6-sol": {
		promptPerToken: 0.000002,
		completionPerToken: 0.00001,
		cachedPerToken: 0.0000002,
	},
	"gpt-5.4": {
		promptPerToken: 0.0000025,
		completionPerToken: 0.00001,
		cachedPerToken: 0.00000025,
	},
	"gpt-5.2": {
		promptPerToken: 0.0000025,
		completionPerToken: 0.00001,
		cachedPerToken: 0.00000025,
	},
	"gpt-5.1-codex": {
		promptPerToken: 0.0000025,
		completionPerToken: 0.00001,
		cachedPerToken: 0.00000025,
	},
	"gpt-4o": {
		promptPerToken: 0.0000025,
		completionPerToken: 0.00001,
		cachedPerToken: 0.00000125,
	},
	"gpt-4o-mini": {
		promptPerToken: 0.00000015,
		completionPerToken: 0.0000006,
		cachedPerToken: 0.000000075,
	},
}

let pricingCache: Map<string, ModelPricing> | null = null
let lastFetchedAt = 0
let inFlightFetch: Promise<Map<string, ModelPricing>> | null = null
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export const clearPricingCache = (): void => {
	pricingCache = null
	lastFetchedAt = 0
	inFlightFetch = null
}

export const normalizeModelKey = (model: string): string =>
	model
		.toLowerCase()
		.replace(/^openai\//, "")
		.replace(/^anthropic\//, "")
		.replace(/^google\//, "")

const getTierFallbackPricing = (modelKey: string): ModelPricing => {
	if (
		modelKey.includes("luna") ||
		modelKey.includes("mini") ||
		modelKey.includes("flash") ||
		modelKey.includes("haiku")
	) {
		return {
			promptPerToken: 0.00000015,
			completionPerToken: 0.0000006,
			cachedPerToken: 0.000000075,
		}
	}
	return {
		promptPerToken: 0.0000025,
		completionPerToken: 0.00001,
		cachedPerToken: 0.0000002,
	}
}

export const fetchOpenRouterPricingTable = async (): Promise<
	Map<string, ModelPricing>
> => {
	const now = Date.now()
	if (pricingCache && now - lastFetchedAt < CACHE_TTL_MS) {
		return pricingCache
	}

	if (inFlightFetch) {
		return inFlightFetch
	}

	const fetchAction = async (): Promise<Map<string, ModelPricing>> => {
		const table = new Map<string, ModelPricing>()

		// Populate fallback pricing first
		for (const [key, val] of Object.entries(FALLBACK_PRICING)) {
			table.set(key, val)
		}

		try {
			const res = await fetch("https://openrouter.ai/api/v1/models", {
				signal: AbortSignal.timeout(3000),
			})
			if (res.ok) {
				const data = (await res.json()) as {
					data?: Array<{
						id: string
						pricing?: {
							prompt?: string
							completion?: string
							input_cache_read?: string
						}
					}>
				}
				if (data && Array.isArray(data.data)) {
					for (const item of data.data) {
						if (item.id && item.pricing) {
							const prompt = Number.parseFloat(item.pricing.prompt || "0")
							const completion = Number.parseFloat(
								item.pricing.completion || "0",
							)
							const cached = Number.parseFloat(
								item.pricing.input_cache_read || `${prompt * 0.5}`,
							)
							const pricing: ModelPricing = {
								promptPerToken: Number.isNaN(prompt) ? 0 : prompt,
								completionPerToken: Number.isNaN(completion) ? 0 : completion,
								cachedPerToken: Number.isNaN(cached) ? 0 : cached,
							}
							table.set(item.id.toLowerCase(), pricing)
							const normalized = normalizeModelKey(item.id)
							table.set(normalized, pricing)
						}
					}
					pricingCache = table
					lastFetchedAt = Date.now()
				}
			}
		} catch {
			// Use fallback if offline or request fails
			if (!pricingCache) {
				pricingCache = table
			}
		} finally {
			inFlightFetch = null
		}

		return pricingCache ?? table
	}

	inFlightFetch = fetchAction()
	return inFlightFetch
}

export const getModelPricing = async (model: string): Promise<ModelPricing> => {
	const table = await fetchOpenRouterPricingTable()
	const key = model.toLowerCase()
	const normalized = normalizeModelKey(model)

	return (
		table.get(key) ??
		table.get(normalized) ??
		FALLBACK_PRICING[normalized] ??
		getTierFallbackPricing(normalized)
	)
}

export const calculateTokenCost = (
	pricing: ModelPricing,
	usage: TokenUsage,
): number => {
	const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0
	const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? 0
	const cachedTokens = usage.cached_tokens ?? usage.cached_input_tokens ?? 0

	const uncachedPromptTokens = Math.max(0, promptTokens - cachedTokens)

	const cost =
		uncachedPromptTokens * pricing.promptPerToken +
		cachedTokens * pricing.cachedPerToken +
		completionTokens * pricing.completionPerToken

	// Round to 6 decimal places to prevent floating point noise
	return Math.round(cost * 1_000_000) / 1_000_000
}

export const formatCost = (cost: number): string => {
	if (cost === 0) {
		return "$0.00"
	}
	if (cost < 0.0001) {
		return `$${cost.toFixed(6)}`
	}
	if (cost < 0.01) {
		return `$${cost.toFixed(4)}`
	}
	return `$${cost.toFixed(2)}`
}

export const injectUsageCost = async (
	response: Response,
	model?: string,
): Promise<{ response: Response; cost?: number }> => {
	if (response.status < 200 || response.status >= 300) {
		return { response }
	}

	const contentType = response.headers.get("content-type")
	if (!contentType?.includes("application/json")) {
		return { response }
	}

	try {
		const clone = response.clone()
		const data = (await clone.json()) as Record<string, unknown> | null
		if (!data || typeof data !== "object") {
			return { response }
		}

		const usage = data.usage as Record<string, unknown> | undefined
		if (!usage || typeof usage !== "object") {
			return { response }
		}

		// If cost is already present (e.g. from OpenRouter), reuse it
		if (typeof usage.cost === "number") {
			return { response, cost: usage.cost }
		}

		const inputDetails = (usage.input_tokens_details ??
			usage.input_token_details) as Record<string, unknown> | undefined
		const promptDetails = (usage.prompt_tokens_details ??
			usage.prompt_token_details) as Record<string, unknown> | undefined
		const cached =
			inputDetails?.cached_tokens ??
			promptDetails?.cached_tokens ??
			usage.cached_tokens

		const pricing = await getModelPricing(model || "gpt-5.2")
		const cost = calculateTokenCost(pricing, {
			prompt_tokens: usage.prompt_tokens as number | undefined,
			input_tokens: usage.input_tokens as number | undefined,
			completion_tokens: usage.completion_tokens as number | undefined,
			output_tokens: usage.output_tokens as number | undefined,
			cached_tokens: typeof cached === "number" ? cached : undefined,
		})

		usage.cost = cost

		const headers = new Headers(response.headers)
		headers.delete("content-length")
		return {
			response: new Response(JSON.stringify(data), {
				status: response.status,
				statusText: response.statusText,
				headers,
			}),
			cost,
		}
	} catch {
		return { response }
	}
}
