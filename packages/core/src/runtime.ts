import { withoutTrailingSlash } from "@ai-sdk/provider-utils"
import {
	type CodexModelInfo,
	fetchCodexModelCatalog,
	isPublicCodexModel,
} from "./models.js"
import { CodexResponsesState } from "./state.js"

export {
	collectCompletedResponseFromSse,
	iterateServerSentEvents,
	type ServerSentEvent,
} from "./sse.js"
export {
	CodexResponsesState,
	type CodexResponsesStateOptions,
	type CodexResponsesStateSnapshot,
} from "./state.js"

import { collectCompletedResponseFromSse } from "./sse.js"

export const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"
export const DEFAULT_OPENAI_COMPATIBLE_BASE_URL =
	"https://openai-oauth.local/v1"
export const DEFAULT_OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
export const DEFAULT_OPENAI_OAUTH_ISSUER = "https://auth.openai.com"
export const DEFAULT_OPENAI_OAUTH_SCOPE = "openid profile email offline_access"
const DEFAULT_CODEX_INSTRUCTIONS = ""
const MODEL_CATALOG_TTL_MS = 5 * 60 * 1000
const MODEL_CATALOG_FAILURE_TTL_MS = 60 * 1000
const RESPONSES_LITE_HEADER = "x-openai-internal-codex-responses-lite"

export type FetchFunction = typeof fetch

export type OpenAIOAuthSession = {
	accessToken: string
	accountId: string
	isFedRamp?: boolean
	idToken?: string
	refreshToken?: string
	expiresAt?: string
	lastRefresh?: string
}

export type OpenAIOAuthSessionInput =
	| OpenAIOAuthSession
	| (() => Promise<OpenAIOAuthSession | null | undefined>)

export type OpenAIOAuth = {
	kind: "openai-oauth"
	getSession(): Promise<OpenAIOAuthSession | null>
	refreshSession(): Promise<OpenAIOAuthSession | null>
	baseURL?: string
	fetch?: FetchFunction
	headers?: Record<string, string>
	instructions?: string
	openAIBaseURL?: string
}

export type SessionStore = {
	get(): Promise<OpenAIOAuthSession | null>
	set(session: OpenAIOAuthSession): Promise<void>
	clear(): Promise<void>
}

export type OpenAIOAuthRequestOptions = {
	clientId?: string
	issuer?: string
	redirectUri: string
	scope?: string
	state?: string
	codeVerifier?: string
	simplifiedFlow?: boolean
	idTokenAddOrganizations?: boolean
	extraParams?: Record<string, string | number | boolean | undefined>
}

export type OpenAIOAuthRequest = {
	authorizationUrl: string
	state: string
	codeVerifier: string
	codeChallenge: string
	redirectUri: string
}

export type OpenAIOAuthTokenResponse = {
	accessToken: string
	refreshToken?: string
	idToken?: string
	expiresIn?: number
	accountId?: string
	isFedRamp?: boolean
	raw: unknown
}

export type ExchangeOpenAIOAuthCodeOptions = {
	code: string
	codeVerifier: string
	redirectUri: string
	clientId?: string
	issuer?: string
	tokenUrl?: string
	fetch?: FetchFunction
	signal?: AbortSignal
}

export type RefreshOpenAIOAuthTokensOptions = {
	refreshToken: string
	clientId?: string
	issuer?: string
	tokenUrl?: string
	fetch?: FetchFunction
	signal?: AbortSignal
}

export type CodexOAuthRuntimeSettings = {
	auth: OpenAIOAuthSessionInput
	baseURL?: string
	codexVersion?: string
	fetch?: FetchFunction
	headers?: Record<string, string>
	instructions?: string
	responsesState?: CodexResponsesState | false
}

export type OpenAIOAuthTransportOptions = CodexOAuthRuntimeSettings & {
	openAIBaseURL?: string
}

export type OpenAIOAuthTransport = {
	kind: "openai-compatible"
	provider: "chatgpt-codex"
	baseURL: string
	fetch: FetchFunction
	request: (path: string, init?: RequestInit) => Promise<Response>
	capabilities: {
		responses: true
		chatCompletions: true
		models: true
		streaming: true
	}
}

export type CodexOAuthClient = {
	baseURL: string
	fetch: FetchFunction
	request: (path: string, init?: RequestInit) => Promise<Response>
}

type RequestParts = {
	url: string
	method?: string
	headers: Headers
	body?: BodyInit | null
	signal?: AbortSignal | null
}

export type NormalizeCodexResponsesBodyOptions = {
	instructions?: string
	forceStream?: boolean
}

type InternalNormalizeCodexResponsesBodyOptions =
	NormalizeCodexResponsesBodyOptions & {
		modelInfo?: CodexModelInfo
	}

const textEncoder = new TextEncoder()

const bytesToBase64Url = (bytes: Uint8Array): string => {
	let binary = ""
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "")
}

const randomURLSafeString = (byteLength: number): string => {
	const bytes = new Uint8Array(byteLength)
	globalThis.crypto.getRandomValues(bytes)
	return bytesToBase64Url(bytes)
}

const createCodeChallenge = async (codeVerifier: string): Promise<string> => {
	const digest = await globalThis.crypto.subtle.digest(
		"SHA-256",
		textEncoder.encode(codeVerifier),
	)
	return bytesToBase64Url(new Uint8Array(digest))
}

const trimTrailingSlash = (value: string): string => value.replace(/\/$/, "")

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

export const usesServerReplayState = (
	value: Record<string, unknown>,
): boolean => {
	if (typeof value.previous_response_id === "string") {
		return true
	}

	if (!Array.isArray(value.input)) {
		return false
	}

	return value.input.some(
		(item) =>
			isRecord(item) &&
			item.type === "item_reference" &&
			typeof item.id === "string",
	)
}

const decodeBase64Url = (value: string): string | undefined => {
	try {
		const padded = value + "=".repeat(((-value.length % 4) + 4) % 4)
		const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"))
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
		return new TextDecoder().decode(bytes)
	} catch {
		return undefined
	}
}

export const parseJwtClaims = (
	token: string | undefined,
): Record<string, unknown> | undefined => {
	if (typeof token !== "string" || !token.includes(".")) {
		return undefined
	}
	const parts = token.split(".")
	if (parts.length !== 3 || parts[1] === undefined) {
		return undefined
	}
	const payload = decodeBase64Url(parts[1])
	if (typeof payload !== "string") {
		return undefined
	}
	try {
		const parsed = JSON.parse(payload)
		return isRecord(parsed) ? parsed : undefined
	} catch {
		return undefined
	}
}

export const deriveAccountId = (
	idToken: string | undefined,
): string | undefined => {
	const claims = parseJwtClaims(idToken)
	if (!claims) {
		return undefined
	}
	const authClaim = claims["https://api.openai.com/auth"]
	if (isRecord(authClaim)) {
		const accountId = authClaim.chatgpt_account_id
		if (typeof accountId === "string" && accountId.length > 0) {
			return accountId
		}
	}

	const topLevelAccountId = claims.chatgpt_account_id
	if (typeof topLevelAccountId === "string" && topLevelAccountId.length > 0) {
		return topLevelAccountId
	}

	const organizations = claims.organizations
	if (Array.isArray(organizations)) {
		const first = organizations[0]
		if (
			isRecord(first) &&
			typeof first.id === "string" &&
			first.id.length > 0
		) {
			return first.id
		}
	}

	return undefined
}

export const deriveChatGptAccountIsFedRamp = (
	token: string | undefined,
): boolean => {
	const claims = parseJwtClaims(token)
	if (!claims) {
		return false
	}

	const authClaim = claims["https://api.openai.com/auth"]
	return isRecord(authClaim) && authClaim.chatgpt_account_is_fedramp === true
}

const resolveTokenUrl = (
	issuer: string,
	tokenUrl: string | undefined,
): string => tokenUrl ?? `${trimTrailingSlash(issuer)}/oauth/token`

const toTokenResponse = (payload: unknown): OpenAIOAuthTokenResponse => {
	if (!isRecord(payload)) {
		throw new Error("OpenAI OAuth token response must be a JSON object.")
	}

	const accessToken =
		typeof payload.access_token === "string" ? payload.access_token : undefined
	if (!accessToken) {
		throw new Error("OpenAI OAuth token response did not include access_token.")
	}

	const refreshToken =
		typeof payload.refresh_token === "string"
			? payload.refresh_token
			: undefined
	const idToken =
		typeof payload.id_token === "string" ? payload.id_token : undefined
	const expiresIn =
		typeof payload.expires_in === "number" ? payload.expires_in : undefined

	return {
		accessToken,
		refreshToken,
		idToken,
		expiresIn,
		accountId: deriveAccountId(idToken) ?? deriveAccountId(accessToken),
		isFedRamp:
			deriveChatGptAccountIsFedRamp(idToken) ||
			deriveChatGptAccountIsFedRamp(accessToken),
		raw: payload,
	}
}

const requestOpenAIOAuthTokens = async (options: {
	clientId?: string
	issuer?: string
	tokenUrl?: string
	fetch?: FetchFunction
	signal?: AbortSignal
	body: Record<string, string>
	encoding: "form" | "json"
}): Promise<OpenAIOAuthTokenResponse> => {
	const issuer = options.issuer ?? DEFAULT_OPENAI_OAUTH_ISSUER
	const isForm = options.encoding === "form"
	const response = await pickFetch(options.fetch)(
		resolveTokenUrl(issuer, options.tokenUrl),
		{
			method: "POST",
			headers: {
				"Content-Type": isForm
					? "application/x-www-form-urlencoded"
					: "application/json",
			},
			body: isForm
				? new URLSearchParams(options.body).toString()
				: JSON.stringify(options.body),
			signal: options.signal,
		},
	)
	const bodyText = await response.text()

	if (!response.ok) {
		let detail = ""
		try {
			const parsed = JSON.parse(bodyText)
			if (isRecord(parsed)) {
				const message =
					parsed.error_description ?? parsed.message ?? parsed.detail
				if (typeof message === "string") {
					detail = ` ${message}`
				}
			}
		} catch {}
		throw new Error(
			`OpenAI OAuth token request failed with HTTP ${response.status}.${detail}`,
		)
	}

	try {
		return toTokenResponse(JSON.parse(bodyText))
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error("OpenAI OAuth token response was not valid JSON.")
		}
		throw error
	}
}

export const createOpenAIOAuthRequest = async (
	options: OpenAIOAuthRequestOptions,
): Promise<OpenAIOAuthRequest> => {
	const state = options.state ?? randomURLSafeString(24)
	const codeVerifier = options.codeVerifier ?? randomURLSafeString(48)
	const codeChallenge = await createCodeChallenge(codeVerifier)
	const issuer = trimTrailingSlash(
		options.issuer ?? DEFAULT_OPENAI_OAUTH_ISSUER,
	)
	const authorizationUrl = new URL(`${issuer}/oauth/authorize`)

	authorizationUrl.searchParams.set("response_type", "code")
	authorizationUrl.searchParams.set(
		"client_id",
		options.clientId ?? DEFAULT_OPENAI_OAUTH_CLIENT_ID,
	)
	authorizationUrl.searchParams.set("redirect_uri", options.redirectUri)
	authorizationUrl.searchParams.set(
		"scope",
		options.scope ?? DEFAULT_OPENAI_OAUTH_SCOPE,
	)
	authorizationUrl.searchParams.set("state", state)
	authorizationUrl.searchParams.set("code_challenge", codeChallenge)
	authorizationUrl.searchParams.set("code_challenge_method", "S256")

	if (options.idTokenAddOrganizations ?? true) {
		authorizationUrl.searchParams.set("id_token_add_organizations", "true")
	}

	if (options.simplifiedFlow ?? true) {
		authorizationUrl.searchParams.set("codex_cli_simplified_flow", "true")
	}

	for (const [key, value] of Object.entries(options.extraParams ?? {})) {
		if (value !== undefined && key !== "originator") {
			authorizationUrl.searchParams.set(key, String(value))
		}
	}

	return {
		authorizationUrl: authorizationUrl.toString(),
		state,
		codeVerifier,
		codeChallenge,
		redirectUri: options.redirectUri,
	}
}

export const exchangeOpenAIOAuthCode = (
	options: ExchangeOpenAIOAuthCodeOptions,
): Promise<OpenAIOAuthTokenResponse> =>
	requestOpenAIOAuthTokens({
		issuer: options.issuer,
		tokenUrl: options.tokenUrl,
		fetch: options.fetch,
		signal: options.signal,
		encoding: "form",
		body: {
			grant_type: "authorization_code",
			code: options.code,
			redirect_uri: options.redirectUri,
			client_id: options.clientId ?? DEFAULT_OPENAI_OAUTH_CLIENT_ID,
			code_verifier: options.codeVerifier,
		},
	})

export const refreshOpenAIOAuthTokens = (
	options: RefreshOpenAIOAuthTokensOptions,
): Promise<OpenAIOAuthTokenResponse> =>
	requestOpenAIOAuthTokens({
		issuer: options.issuer,
		tokenUrl: options.tokenUrl,
		fetch: options.fetch,
		signal: options.signal,
		encoding: "json",
		body: {
			grant_type: "refresh_token",
			refresh_token: options.refreshToken,
			client_id: options.clientId ?? DEFAULT_OPENAI_OAUTH_CLIENT_ID,
		},
	})

const pickFetch = (customFetch?: FetchFunction): FetchFunction => {
	if (typeof customFetch === "function") {
		return customFetch
	}

	if (typeof globalThis.fetch === "function") {
		return globalThis.fetch.bind(globalThis)
	}

	throw new Error("A fetch implementation is required for OpenAI OAuth.")
}

const resolveBaseURL = (baseURL?: string): string =>
	withoutTrailingSlash(baseURL) ?? DEFAULT_CODEX_BASE_URL

const resolveOpenAIBaseURL = (baseURL?: string): string =>
	withoutTrailingSlash(baseURL) ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL

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

export const getDefaultCodexInstructions = (): string =>
	DEFAULT_CODEX_INSTRUCTIONS

const normalizeResponsesInput = (input: unknown): unknown =>
	typeof input === "string"
		? [
				{
					role: "user",
					content: [{ type: "input_text", text: input }],
				},
			]
		: input

const addEncryptedReasoningContent = (include: unknown): string[] => {
	const values = Array.isArray(include)
		? include.filter((value): value is string => typeof value === "string")
		: []
	if (!values.includes("reasoning.encrypted_content")) {
		values.push("reasoning.encrypted_content")
	}
	return values
}

const applyModelDefaults = (
	normalized: Record<string, unknown>,
	modelInfo: CodexModelInfo | undefined,
): void => {
	if (!modelInfo) {
		return
	}

	const reasoning = isRecord(normalized.reasoning)
		? { ...normalized.reasoning }
		: {}
	if (
		reasoning.effort === undefined &&
		modelInfo.defaultReasoningLevel !== undefined
	) {
		reasoning.effort = modelInfo.defaultReasoningLevel
	}
	if (modelInfo.useResponsesLite) {
		reasoning.context = "all_turns"
	}
	if (Object.keys(reasoning).length > 0) {
		normalized.reasoning = reasoning
	}

	if (modelInfo.supportVerbosity && modelInfo.defaultVerbosity !== undefined) {
		const text = isRecord(normalized.text) ? { ...normalized.text } : {}
		if (text.verbosity === undefined) {
			text.verbosity = modelInfo.defaultVerbosity
		}
		normalized.text = text
	}

	if (!modelInfo.useResponsesLite) {
		return
	}

	const input = Array.isArray(normalized.input) ? [...normalized.input] : []
	const prefix: unknown[] = []
	const tools = Array.isArray(normalized.tools) ? normalized.tools : []
	if (
		tools.length > 0 &&
		!input.some((item) => isRecord(item) && item.type === "additional_tools")
	) {
		prefix.push({
			type: "additional_tools",
			role: "developer",
			tools,
		})
	}

	if (typeof normalized.instructions === "string" && normalized.instructions) {
		prefix.push({
			role: "developer",
			content: [{ type: "input_text", text: normalized.instructions }],
		})
	}

	normalized.input = [...prefix, ...input]
	normalized.instructions = ""
	normalized.parallel_tool_calls = false
	delete normalized.tools
}

const normalizeCodexResponsesBodyInternal = (
	body: Record<string, unknown>,
	options: InternalNormalizeCodexResponsesBodyOptions = {},
): Record<string, unknown> => {
	const normalized = { ...body }
	const instructions =
		typeof normalized.instructions === "string"
			? normalized.instructions
			: (options.instructions ?? getDefaultCodexInstructions())

	normalized.instructions = instructions
	normalized.input = normalizeResponsesInput(normalized.input)
	normalized.store = false
	normalized.include = addEncryptedReasoningContent(normalized.include)
	applyModelDefaults(normalized, options.modelInfo)

	if (options.forceStream) {
		normalized.stream = true
	}
	delete normalized.max_output_tokens
	return normalized
}

export const normalizeCodexResponsesBody = (
	body: Record<string, unknown>,
	options: NormalizeCodexResponsesBodyOptions = {},
): Record<string, unknown> => normalizeCodexResponsesBodyInternal(body, options)

type PreparedResponsesRequestBody = {
	body: BodyInit | null | undefined
	requestBody?: Record<string, unknown>
	wantsStream?: boolean
}

type ResolveModelInfo = (
	auth: OpenAIOAuthSession,
	model: string,
) => Promise<CodexModelInfo | undefined>

type ModelCatalogResult = {
	models: CodexModelInfo[]
	error?: Error
}

type ResolveModelCatalog = (
	auth: OpenAIOAuthSession,
) => Promise<ModelCatalogResult>

const prepareResponsesRequestBody = async (
	pathname: string,
	headers: Headers,
	body: BodyInit | null | undefined,
	settings: CodexOAuthRuntimeSettings,
	state: CodexResponsesState | undefined,
	auth: OpenAIOAuthSession,
	resolveModelInfo: ResolveModelInfo,
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
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return { body }
		}
		const wantsStream = parsed.stream === true
		const modelInfo =
			typeof parsed.model === "string"
				? await resolveModelInfo(auth, parsed.model)
				: undefined

		const normalized = normalizeCodexResponsesBodyInternal(parsed, {
			forceStream: true,
			instructions: settings.instructions,
			modelInfo,
		})
		if (modelInfo?.useResponsesLite) {
			headers.set(RESPONSES_LITE_HEADER, "true")
		}

		if (state?.requiresCachedState(normalized)) {
			await state.waitForPendingCaptures()
		}

		const expanded = state?.expandRequestBody(normalized) ?? normalized

		return {
			body: JSON.stringify(expanded),
			requestBody: expanded,
			wantsStream,
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

const finalizeResponsesResponse = async (
	response: Response,
	prepared: PreparedResponsesRequestBody,
	state: CodexResponsesState | undefined,
): Promise<Response> => {
	if (
		prepared.requestBody == null ||
		prepared.wantsStream == null ||
		!response.ok ||
		response.body == null
	) {
		return response
	}

	if (prepared.wantsStream) {
		return captureResponsesState(response, prepared.requestBody, state)
	}

	const completed = await collectCompletedResponseFromSse(response.body)
	state?.rememberResponse(completed, prepared.requestBody)
	const headers = new Headers(response.headers)
	headers.delete("content-encoding")
	headers.delete("content-length")
	headers.set("content-type", "application/json")
	return new Response(JSON.stringify(completed), {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
}

const applyAuthHeaders = (headers: Headers, auth: OpenAIOAuthSession): void => {
	headers.delete("authorization")
	headers.delete("chatgpt-account-id")
	headers.delete("openai-beta")
	headers.delete(RESPONSES_LITE_HEADER)
	headers.delete("x-openai-fedramp")
	headers.set("Authorization", `Bearer ${auth.accessToken}`)
	headers.set("chatgpt-account-id", auth.accountId)

	const isFedRamp =
		auth.isFedRamp ??
		(deriveChatGptAccountIsFedRamp(auth.idToken) ||
			deriveChatGptAccountIsFedRamp(auth.accessToken))
	if (isFedRamp) {
		headers.set("X-OpenAI-Fedramp", "true")
	}
}

const createModelCatalogResolver = (
	fetch: FetchFunction,
	baseURL: string,
	settings: CodexOAuthRuntimeSettings,
): ResolveModelCatalog => {
	const cache = new Map<
		string,
		{ expiresAt: number; result: ModelCatalogResult }
	>()
	const inflight = new Map<string, Promise<ModelCatalogResult>>()

	return async (auth) => {
		const cacheKey = `${auth.accountId}:${auth.isFedRamp === true}`
		const cached = cache.get(cacheKey)
		if (cached && cached.expiresAt > Date.now()) {
			return cached.result
		}

		let loading = inflight.get(cacheKey)
		if (!loading) {
			loading = (async (): Promise<ModelCatalogResult> => {
				try {
					const models = await fetchCodexModelCatalog(
						{
							request: async (path, init) => {
								const headers = new Headers(settings.headers)
								new Headers(init?.headers).forEach((value, key) => {
									headers.set(key, value)
								})
								applyAuthHeaders(headers, auth)
								return fetch(
									new URL(path.replace(/^\//, ""), `${baseURL}/`).toString(),
									{
										...init,
										method: init?.method ?? "GET",
										headers,
									},
								)
							},
						},
						{
							codexVersion: settings.codexVersion,
							fetchImpl: fetch,
						},
					)
					const result = { models }
					cache.set(cacheKey, {
						expiresAt: Date.now() + MODEL_CATALOG_TTL_MS,
						result,
					})
					return result
				} catch (error) {
					const result = {
						models: [],
						error:
							error instanceof Error
								? error
								: new Error("Failed to load models from Codex."),
					}
					cache.set(cacheKey, {
						expiresAt: Date.now() + MODEL_CATALOG_FAILURE_TTL_MS,
						result,
					})
					return result
				}
			})().finally(() => {
				inflight.delete(cacheKey)
			})
			inflight.set(cacheKey, loading)
		}

		return loading
	}
}

const resolveAuth = async (
	source: OpenAIOAuthSessionInput,
): Promise<OpenAIOAuthSession> => {
	const auth = typeof source === "function" ? await source() : source
	if (!auth) {
		throw new Error("OpenAI OAuth session not found.")
	}
	return auth
}

export const createCodexOAuthFetch = (
	settings: CodexOAuthRuntimeSettings,
): FetchFunction => {
	const fetch = pickFetch(settings.fetch)
	const baseURL = resolveBaseURL(settings.baseURL)
	const responsesState =
		settings.responsesState === false
			? undefined
			: (settings.responsesState ?? new CodexResponsesState())
	const resolveModelCatalog = createModelCatalogResolver(
		fetch,
		baseURL,
		settings,
	)
	const resolveModelInfo: ResolveModelInfo = async (auth, model) =>
		(await resolveModelCatalog(auth)).models.find(
			(entry) => entry.slug === model,
		)

	return async (input, init) => {
		const request = await readRequestParts(input, init)
		const targetUrl = resolveTargetUrl(request.url, baseURL)
		const target = new URL(targetUrl)
		const auth = await resolveAuth(settings.auth)
		if (
			(request.method ?? "GET").toUpperCase() === "GET" &&
			target.pathname.endsWith("/models") &&
			!target.searchParams.has("client_version")
		) {
			const catalog = await resolveModelCatalog(auth)
			const models = catalog.models.filter(isPublicCodexModel)
			if (models.length === 0) {
				return Response.json(
					{
						error: {
							message:
								catalog.error?.message ?? "Failed to load models from Codex.",
						},
					},
					{ status: 502 },
				)
			}
			return Response.json({
				object: "list",
				data: models.map((model) => ({
					id: model.slug,
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				})),
			})
		}

		const headers = new Headers(settings.headers)
		request.headers.forEach((value, key) => {
			headers.set(key, value)
		})
		applyAuthHeaders(headers, auth)

		const preparedBody = await prepareResponsesRequestBody(
			target.pathname,
			headers,
			request.body,
			settings,
			responsesState,
			auth,
			resolveModelInfo,
		)

		const response = await fetch(target.toString(), {
			method: request.method ?? init?.method,
			headers,
			body: preparedBody.body,
			signal: request.signal ?? undefined,
		})

		return finalizeResponsesResponse(response, preparedBody, responsesState)
	}
}

const resolveOpenAICompatibleUrl = (path: string, baseURL: string): string => {
	if (/^https?:\/\//.test(path)) {
		return path
	}

	const normalizedPath = path.startsWith("/v1/")
		? path.slice("/v1/".length)
		: path.replace(/^\//, "")

	return new URL(normalizedPath, `${baseURL}/`).toString()
}

export const createCodexOAuthClient = (
	settings: CodexOAuthRuntimeSettings,
): CodexOAuthClient => {
	const baseURL = resolveBaseURL(settings.baseURL)
	const fetch = createCodexOAuthFetch(settings)

	return {
		baseURL,
		fetch,
		request: (path, init) =>
			fetch(new URL(path, `${baseURL}/`).toString(), init),
	}
}

export const createOpenAIOAuthTransport = (
	settings: OpenAIOAuthTransportOptions,
): OpenAIOAuthTransport => {
	const baseURL = resolveOpenAIBaseURL(settings.openAIBaseURL)
	const fetch = createCodexOAuthFetch(settings)

	return {
		kind: "openai-compatible",
		provider: "chatgpt-codex",
		baseURL,
		fetch,
		request: (path, init) =>
			fetch(resolveOpenAICompatibleUrl(path, baseURL), init),
		capabilities: {
			responses: true,
			chatCompletions: true,
			models: true,
			streaming: true,
		},
	}
}
