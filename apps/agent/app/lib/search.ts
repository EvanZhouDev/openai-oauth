const SEARCH_TIMEOUT_MS = 15_000
const FETCH_TIMEOUT_MS = 20_000
const MAX_PAGE_BYTES = 2 * 1024 * 1024
const MAX_PAGE_CHARS = 14_000

export type SearchResult = {
	title: string
	url: string
	snippet: string
}

export type SearchResponse = {
	provider: string
	query: string
	results: SearchResult[]
}

const BLOCKED_HOSTS =
	/^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|metadata\.google\.internal$)/i

const decodeEntities = (value: string): string =>
	value
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&#x27;/gi, "'")
		.replace(/&#(\d+);/g, (_, code: string) =>
			String.fromCodePoint(Number(code)),
		)

const stripTags = (value: string): string =>
	decodeEntities(value.replace(/<[^>]*>/g, " "))
		.replace(/\s+/g, " ")
		.trim()

/** DuckDuckGo wraps outbound links as `/l/?uddg=<encoded target>`. */
const unwrapRedirect = (href: string): string => {
	const match = href.match(/[?&]uddg=([^&]+)/)
	const target = match?.[1] ? decodeURIComponent(match[1]) : href
	return target.startsWith("//") ? `https:${target}` : target
}

export const assertFetchableUrl = (rawUrl: string): URL => {
	let url: URL
	try {
		url = new URL(rawUrl)
	} catch {
		throw new Error(`"${rawUrl}" is not a valid URL.`)
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Only http and https URLs can be fetched.")
	}
	if (BLOCKED_HOSTS.test(url.hostname) || url.hostname.endsWith(".local")) {
		throw new Error(
			"Refusing to fetch private or loopback addresses from the sandbox.",
		)
	}
	return url
}

const timeoutSignal = (ms: number, external?: AbortSignal): AbortSignal =>
	external
		? AbortSignal.any([external, AbortSignal.timeout(ms)])
		: AbortSignal.timeout(ms)

const braveSearch = async (
	query: string,
	count: number,
	signal?: AbortSignal,
): Promise<SearchResponse | null> => {
	const key = process.env.BRAVE_SEARCH_API_KEY
	if (!key) {
		return null
	}
	const response = await fetch(
		`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
		{
			headers: { accept: "application/json", "x-subscription-token": key },
			signal: timeoutSignal(SEARCH_TIMEOUT_MS, signal),
		},
	)
	if (!response.ok) {
		return null
	}
	const payload = (await response.json()) as {
		web?: {
			results?: Array<{ title?: string; url?: string; description?: string }>
		}
	}
	const results = (payload.web?.results ?? [])
		.filter((item) => typeof item.url === "string")
		.slice(0, count)
		.map((item) => ({
			title: stripTags(item.title ?? item.url ?? ""),
			url: item.url as string,
			snippet: stripTags(item.description ?? ""),
		}))
	return results.length > 0 ? { provider: "brave", query, results } : null
}

const tavilySearch = async (
	query: string,
	count: number,
	signal?: AbortSignal,
): Promise<SearchResponse | null> => {
	const key = process.env.TAVILY_API_KEY
	if (!key) {
		return null
	}
	const response = await fetch("https://api.tavily.com/search", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${key}`,
		},
		body: JSON.stringify({ query, max_results: count }),
		signal: timeoutSignal(SEARCH_TIMEOUT_MS, signal),
	})
	if (!response.ok) {
		return null
	}
	const payload = (await response.json()) as {
		results?: Array<{ title?: string; url?: string; content?: string }>
	}
	const results = (payload.results ?? [])
		.filter((item) => typeof item.url === "string")
		.slice(0, count)
		.map((item) => ({
			title: stripTags(item.title ?? ""),
			url: item.url as string,
			snippet: stripTags(item.content ?? ""),
		}))
	return results.length > 0 ? { provider: "tavily", query, results } : null
}

const searxngSearch = async (
	query: string,
	count: number,
	signal?: AbortSignal,
): Promise<SearchResponse | null> => {
	const base = process.env.SEARXNG_URL
	if (!base) {
		return null
	}
	const response = await fetch(
		`${base.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&format=json`,
		{
			headers: { accept: "application/json" },
			signal: timeoutSignal(SEARCH_TIMEOUT_MS, signal),
		},
	)
	if (!response.ok) {
		return null
	}
	const payload = (await response.json()) as {
		results?: Array<{ title?: string; url?: string; content?: string }>
	}
	const results = (payload.results ?? [])
		.filter((item) => typeof item.url === "string")
		.slice(0, count)
		.map((item) => ({
			title: stripTags(item.title ?? ""),
			url: item.url as string,
			snippet: stripTags(item.content ?? ""),
		}))
	return results.length > 0 ? { provider: "searxng", query, results } : null
}

const ANCHOR_PATTERN = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
const HREF_PATTERN = /href=["']([^"']+)["']/i
const SNIPPET_PATTERN =
	/class=["'][^"']*result[-_]snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:td|a|div)>/gi

const parseDuckDuckGoHtml = (html: string, count: number): SearchResult[] => {
	const links: Array<{ title: string; url: string }> = []
	for (const match of html.matchAll(ANCHOR_PATTERN)) {
		const attributes = match[1] ?? ""
		if (!/class=["'][^"']*result[-_](link|a)\b[^"']*["']/i.test(attributes)) {
			continue
		}
		const href = attributes.match(HREF_PATTERN)?.[1]
		const title = stripTags(match[2] ?? "")
		if (!href || title.length === 0) {
			continue
		}
		const url = unwrapRedirect(decodeEntities(href))
		if (/^https?:\/\//.test(url)) {
			links.push({ title, url })
		}
	}

	const snippets = [...html.matchAll(SNIPPET_PATTERN)].map((match) =>
		stripTags(match[1] ?? ""),
	)

	return links.slice(0, count).map((link, index) => ({
		...link,
		snippet: snippets[index] ?? "",
	}))
}

const duckDuckGoSearch = async (
	query: string,
	count: number,
	signal?: AbortSignal,
): Promise<SearchResponse | null> => {
	const endpoints = [
		`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
		`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
	]

	for (const endpoint of endpoints) {
		try {
			const response = await fetch(endpoint, {
				headers: {
					accept: "text/html",
					"accept-language": "en-US,en;q=0.9",
					"user-agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
				},
				signal: timeoutSignal(SEARCH_TIMEOUT_MS, signal),
			})
			if (!response.ok) {
				continue
			}
			const results = parseDuckDuckGoHtml(await response.text(), count)
			if (results.length > 0) {
				return { provider: "duckduckgo", query, results }
			}
		} catch {
			// Try the next endpoint.
		}
	}
	return null
}

const duckDuckGoInstantAnswer = async (
	query: string,
	count: number,
	signal?: AbortSignal,
): Promise<SearchResponse | null> => {
	try {
		const response = await fetch(
			`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
			{
				headers: { accept: "application/json" },
				signal: timeoutSignal(SEARCH_TIMEOUT_MS, signal),
			},
		)
		if (!response.ok) {
			return null
		}
		const payload = (await response.json()) as {
			AbstractText?: string
			AbstractURL?: string
			Heading?: string
			RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>
		}
		const results: SearchResult[] = []
		if (payload.AbstractURL && payload.AbstractText) {
			results.push({
				title: payload.Heading ?? payload.AbstractURL,
				url: payload.AbstractURL,
				snippet: payload.AbstractText,
			})
		}
		for (const topic of payload.RelatedTopics ?? []) {
			if (topic.FirstURL && topic.Text && results.length < count) {
				results.push({
					title: topic.Text.split(" - ")[0] ?? topic.Text,
					url: topic.FirstURL,
					snippet: topic.Text,
				})
			}
		}
		return results.length > 0
			? { provider: "duckduckgo-instant", query, results }
			: null
	} catch {
		return null
	}
}

/**
 * Searches the web. Uses whichever API key is configured, otherwise falls back
 * to DuckDuckGo, which needs no key at all.
 */
export const webSearch = async (
	query: string,
	count = 6,
	signal?: AbortSignal,
): Promise<SearchResponse> => {
	const limit = Math.min(Math.max(count, 1), 10)
	const providers = [
		braveSearch,
		tavilySearch,
		searxngSearch,
		duckDuckGoSearch,
		duckDuckGoInstantAnswer,
	]

	for (const provider of providers) {
		try {
			const response = await provider(query, limit, signal)
			if (response) {
				return response
			}
		} catch {
			// Fall through to the next provider.
		}
	}

	throw new Error(
		"No search provider returned results. Set BRAVE_SEARCH_API_KEY, TAVILY_API_KEY or SEARXNG_URL for a more reliable backend.",
	)
}

const htmlToText = (html: string): string => {
	const withoutNoise = html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
		.replace(/<svg[\s\S]*?<\/svg>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<\/(p|div|section|article|li|tr|h[1-6]|pre|blockquote)>/gi, "\n")
		.replace(/<br\s*\/?>/gi, "\n")

	return decodeEntities(withoutNoise.replace(/<[^>]*>/g, " "))
		.replace(/[ \t\f\v]+/g, " ")
		.replace(/\n\s*\n\s*\n+/g, "\n\n")
		.trim()
}

export type FetchedPage = {
	url: string
	title: string
	contentType: string
	text: string
	truncated: boolean
}

export const fetchPage = async (
	rawUrl: string,
	signal?: AbortSignal,
): Promise<FetchedPage> => {
	const url = assertFetchableUrl(rawUrl)
	const response = await fetch(url, {
		headers: {
			accept:
				"text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8",
			"user-agent":
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
		},
		redirect: "follow",
		signal: timeoutSignal(FETCH_TIMEOUT_MS, signal),
	})

	if (!response.ok) {
		throw new Error(`Request failed with status ${response.status}.`)
	}

	const contentType = response.headers.get("content-type") ?? "text/plain"
	const buffer = await response.arrayBuffer()
	const body = Buffer.from(buffer.slice(0, MAX_PAGE_BYTES)).toString("utf8")
	const title = stripTags(
		body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "",
	)
	const text = /html/i.test(contentType) ? htmlToText(body) : body

	return {
		url: url.toString(),
		title: title || url.hostname,
		contentType,
		text: text.slice(0, MAX_PAGE_CHARS),
		truncated:
			text.length > MAX_PAGE_CHARS || buffer.byteLength > MAX_PAGE_BYTES,
	}
}
