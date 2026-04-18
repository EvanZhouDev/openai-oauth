import {
	type FetchFunction,
	withoutTrailingSlash,
} from "@ai-sdk/provider-utils"
import {
	type AuthLoaderOptions,
	type EffectiveAuth,
	loadAuthTokens,
} from "./auth.js"
import { collectCompletedResponseFromSse } from "./sse.js"
import { CodexResponsesState } from "./state.js"

export const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"
const DEFAULT_CODEX_INSTRUCTIONS = ""

export type CodexOAuthSettings = Omit<AuthLoaderOptions, "fetch"> & {
	baseURL?: string
	codexVersion?: string
	fetch?: FetchFunction
	headers?: Record<string, string>
	instructions?: string
	store?: boolean
	responsesState?: CodexResponsesState | false
}

type RequestParts = {
	url: string
	method?: string
	headers: Headers
	body?: BodyInit | null
	signal?: AbortSignal | null
}

class AuthManager {
	private current?: EffectiveAuth
	private inflight?: Promise<EffectiveAuth>
	private readonly settings: CodexOAuthSettings
	private readonly fetch: FetchFunction

	constructor(settings: CodexOAuthSettings, fetch: FetchFunction) {
		this.settings = settings
		this.fetch = fetch
	}

	async ensure(): Promise<EffectiveAuth> {
		if (this.inflight) {
			return this.inflight
		}

		this.inflight = loadAuthTokens({
			authFilePath: this.settings.authFilePath,
			clientId: this.settings.clientId,
			issuer: this.settings.issuer,
			tokenUrl: this.settings.tokenUrl,
			fetch: this.fetch,
			ensureFresh: this.settings.ensureFresh,
			now: this.settings.now,
		})
			.then((auth) => {
				this.current = auth
				this.inflight = undefined
				return auth
			})
			.catch((error) => {
				this.inflight = undefined
				throw error
			})

		return this.inflight
	}

	async headers(): Promise<Record<string, string>> {
		const auth = this.current ?? (await this.ensure())
		return {
			Authorization: `Bearer ${auth.accessToken}`,
			"chatgpt-account-id": auth.accountId,
			"OpenAI-Beta": "responses=experimental",
		}
	}
}

const pickFetch = (customFetch?: FetchFunction): FetchFunction => {
	if (typeof customFetch === "function") {
		return customFetch
	}

	if (typeof globalThis.fetch === "function") {
		return globalThis.fetch
	}

	throw new Error("A fetch implementation is required for Codex OAuth.")
}

export const getDefaultCodexInstructions = (): string => {
	return DEFAULT_CODEX_INSTRUCTIONS
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const resolveBaseURL = (baseURL?: string): string => {
	return withoutTrailingSlash(baseURL) ?? DEFAULT_CODEX_BASE_URL
}

const resolveTargetUrl = (input: string, baseURL: string): string => {
	const base = new URL(baseURL)
	const parsed = /^https?:\/\//.test(input)
		? new URL(input)
		: new URL(input, "https://codex.invalid")
	let pathname = parsed.pathname
	const basePath = withoutTrailingSlash(base.pathname) ?? ""

	if (pathname === basePath) {
		pathname = "/"
	} else if (basePath.length > 0 && pathname.startsWith(`${basePath}/`)) {
		pathname = pathname.slice(basePath.length)
	}

	if (pathname === "/v1") {
		pathname = "/"
	} else if (pathname.startsWith("/v1/")) {
		pathname = pathname.slice(3)
	}

	return `${base.origin}${basePath}${pathname}${parsed.search}`
}

const readRequestParts = async (
	input: Parameters<FetchFunction>[0],
	init: Parameters<FetchFunction>[1],
): Promise<RequestParts> => {
	if (input instanceof Request) {
		const headers = new Headers(input.headers)
		if (init?.headers) {
			new Headers(init.headers).forEach((value, key) => {
				headers.set(key, value)
			})
		}

		return {
			url: input.url,
			method: init?.method ?? input.method,
			headers,
			body:
				init?.body ??
				(input.body == null ? undefined : await input.clone().text()),
			signal: init?.signal ?? input.signal,
		}
	}

	return {
		url: String(input),
		method: init?.method,
		headers: new Headers(init?.headers),
		body: init?.body,
		signal: init?.signal,
	}
}

const decodeBody = async (
	body: BodyInit | null | undefined,
): Promise<string | undefined> => {
	if (body == null) {
		return undefined
	}

	if (typeof body === "string") {
		return body
	}

	if (body instanceof URLSearchParams || body instanceof FormData) {
		return undefined
	}

	if (body instanceof ReadableStream) {
		return undefined
	}

	if (body instanceof Blob) {
		return body.text()
	}

	if (body instanceof ArrayBuffer) {
		return new TextDecoder().decode(body)
	}

	if (ArrayBuffer.isView(body)) {
		return new TextDecoder().decode(body)
	}

	return undefined
}

export type NormalizeCodexResponsesBodyOptions = {
	instructions?: string
	forceStream?: boolean
	store?: boolean
}

export const normalizeCodexResponsesBody = (
	body: Record<string, unknown>,
	options: NormalizeCodexResponsesBodyOptions = {},
): Record<string, unknown> => {
	const normalized: Record<string, unknown> = { ...body }
	const instructions =
		typeof normalized.instructions === "string"
			? normalized.instructions
			: (options.instructions ?? getDefaultCodexInstructions())

	normalized.instructions = instructions

	if (normalized.store === undefined) {
		normalized.store = options.store ?? false
	}

	if (options.forceStream) {
		normalized.stream = true
	}

	delete normalized.max_output_tokens
	// Codex backend rejects these params; strip for compatibility with LiteLLM/Anthropic-format clients.
	delete normalized.user
	delete normalized.temperature
	delete normalized.top_p

	// LiteLLM translates Anthropic's web_search server tool to OpenAI's public name
	// (web_search_preview). The Codex backend uses the internal name (web_search) and
	// requires external_web_access:true to perform live searches (default is cached mode).
	let renamedWebSearch = false
	if (Array.isArray(normalized.tools)) {
		normalized.tools = (normalized.tools as unknown[]).map((t) => {
			if (t && typeof t === "object" && (t as Record<string, unknown>).type === "web_search_preview") {
				renamedWebSearch = true
				return { ...(t as Record<string, unknown>), type: "web_search", external_web_access: true }
			}
			return t
		})
	}
	if (renamedWebSearch && normalized.tool_choice && normalized.tool_choice !== "none") {
		normalized.tool_choice = "auto"
	}

	return normalized
}

type PreparedResponsesRequestBody = {
	body: BodyInit | null | undefined
	requestBody?: Record<string, unknown>
}

const prepareResponsesRequestBody = async (
	pathname: string,
	headers: Headers,
	body: BodyInit | null | undefined,
	settings: CodexOAuthSettings,
	state: CodexResponsesState | undefined,
): Promise<PreparedResponsesRequestBody> => {
	if (!pathname.endsWith("/responses")) {
		return { body }
	}

	const contentType = headers.get("content-type")
	if (contentType && !contentType.includes("application/json")) {
		return { body }
	}

	const bodyText = await decodeBody(body)
	if (typeof bodyText !== "string") {
		return { body }
	}

	try {
		const parsed = JSON.parse(bodyText)
		if (!isRecord(parsed)) {
			return { body }
		}

		const normalized = normalizeCodexResponsesBody(parsed, {
			instructions: settings.instructions,
			store: settings.store,
		})

		if (state?.requiresCachedState(normalized)) {
			await state.waitForPendingCaptures()
		}

		const expanded = state?.expandRequestBody(normalized) ?? normalized

		return {
			body: JSON.stringify(expanded),
			requestBody: expanded,
		}
	} catch {
		return { body }
	}
}

const captureResponsesState = (
	response: Response,
	requestBody: Record<string, unknown> | undefined,
	state: CodexResponsesState | undefined,
): Response => {
	if (
		state == null ||
		requestBody == null ||
		!response.ok ||
		response.body == null
	) {
		return response
	}

	const [returnedBody, cachedBody] = response.body.tee()
	const capturePromise = collectCompletedResponseFromSse(cachedBody)
		.then((completedResponse) => {
			state.rememberResponse(completedResponse, requestBody)
		})
		.catch(() => undefined)
	state.trackPendingCapture(capturePromise)

	return new Response(returnedBody, {
		status: response.status,
		statusText: response.statusText,
		headers: new Headers(response.headers),
	})
}

export const createCodexOAuthFetch = (
	settings: CodexOAuthSettings = {},
): FetchFunction => {
	const fetch = pickFetch(settings.fetch)
	const authManager = new AuthManager(settings, fetch)
	const baseURL = resolveBaseURL(settings.baseURL)
	const responsesState =
		settings.responsesState === false
			? undefined
			: (settings.responsesState ?? new CodexResponsesState())
	const codexFetch: FetchFunction = async (
		input: Parameters<FetchFunction>[0],
		init: Parameters<FetchFunction>[1],
	) => {
		const request = await readRequestParts(input, init)
		const targetUrl = resolveTargetUrl(request.url, baseURL)
		const target = new URL(targetUrl)

		const headers = new Headers(settings.headers)
		request.headers.forEach((value, key) => {
			headers.set(key, value)
		})
		headers.delete("authorization")
		headers.delete("chatgpt-account-id")
		headers.delete("openai-beta")

		const authHeaders = await authManager.headers()
		for (const [key, value] of Object.entries(authHeaders)) {
			headers.set(key, value)
		}

		const preparedBody = await prepareResponsesRequestBody(
			target.pathname,
			headers,
			request.body,
			settings,
			responsesState,
		)

		const response = await fetch(target.toString(), {
			method: request.method ?? init?.method,
			headers,
			body: preparedBody.body,
			signal: request.signal ?? undefined,
		})

		return captureResponsesState(
			response,
			preparedBody.requestBody,
			responsesState,
		)
	}

	if (typeof fetch.preconnect === "function") {
		codexFetch.preconnect = fetch.preconnect.bind(fetch)
	}

	return codexFetch
}

export type CodexOAuthClient = {
	baseURL: string
	fetch: FetchFunction
	request: (path: string, init?: RequestInit) => Promise<Response>
}

export const createCodexOAuthClient = (
	settings: CodexOAuthSettings = {},
): CodexOAuthClient => {
	const baseURL = resolveBaseURL(settings.baseURL)
	const fetch = createCodexOAuthFetch(settings)

	return {
		baseURL,
		fetch,
		request: (path, init) => fetch(resolveTargetUrl(path, baseURL), init),
	}
}
