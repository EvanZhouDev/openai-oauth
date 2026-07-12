import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
	deriveAccountId,
	deriveChatGptAccountIsFedRamp,
	type FetchFunction,
	type OpenAIOAuthTokenResponse,
	parseJwtClaims,
	refreshOpenAIOAuthTokens,
} from "@openai-oauth/core"

const AUTH_FILENAME = "auth.json"
const REFRESH_EXPIRY_MARGIN_MS = 5 * 60 * 1000
const REFRESH_INTERVAL_MS = 55 * 60 * 1000

type StoredTokens = {
	id_token?: string
	access_token?: string
	refresh_token?: string
	account_id?: string
}

type AuthFile = {
	[key: string]: unknown
	OPENAI_API_KEY?: string
	tokens?: StoredTokens
	last_refresh?: string
}

export type EffectiveAuth = {
	accessToken: string
	accountId: string
	isFedRamp?: boolean
	idToken?: string
	refreshToken?: string
	sourcePath?: string
	lastRefresh?: string
}

export type AuthLoaderOptions = {
	clientId?: string
	issuer?: string
	tokenUrl?: string
	authFilePath?: string
	fetch: FetchFunction
	ensureFresh?: boolean
	now?: () => Date
}

export type SaveAuthTokensOptions = {
	token: OpenAIOAuthTokenResponse
	authFilePath?: string
	now?: () => Date
}

export type SavedAuthTokens = {
	path: string
	auth: EffectiveAuth
}

type AuthReadResult = {
	path?: string
	data?: AuthFile
}

type RefreshOutcome = {
	accessToken: string
	idToken?: string
	refreshToken?: string
	accountId?: string
	isFedRamp?: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const parseIsoDate = (value: string | undefined): Date | undefined => {
	if (typeof value !== "string" || !value) {
		return undefined
	}
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? undefined : date
}

const shouldRefreshAccessToken = (
	accessToken: string | undefined,
	lastRefresh: string | undefined,
	now: Date,
): boolean => {
	if (typeof accessToken !== "string" || accessToken.length === 0) {
		return true
	}

	const claims = parseJwtClaims(accessToken)
	const exp = claims && typeof claims.exp === "number" ? claims.exp : undefined
	if (typeof exp === "number") {
		const expiryMs = exp * 1000
		if (expiryMs <= now.getTime() + REFRESH_EXPIRY_MARGIN_MS) {
			return true
		}
	}

	const refreshedAt = parseIsoDate(lastRefresh)
	if (refreshedAt) {
		return refreshedAt.getTime() <= now.getTime() - REFRESH_INTERVAL_MS
	}
	return false
}

const uniquePaths = (paths: string[]): string[] => {
	const seen = new Set<string>()
	const result: string[] = []

	for (const candidate of paths) {
		if (!seen.has(candidate)) {
			seen.add(candidate)
			result.push(candidate)
		}
	}

	return result
}

export const resolveAuthFileCandidates = (authFilePath?: string): string[] => {
	if (typeof authFilePath === "string" && authFilePath.length > 0) {
		return [authFilePath]
	}

	const codexHome = process.env.CODEX_HOME

	return uniquePaths(
		[
			authFilePath,
			codexHome ? path.join(codexHome, AUTH_FILENAME) : undefined,
			path.join(os.homedir(), ".codex", AUTH_FILENAME),
		].filter(
			(value): value is string => typeof value === "string" && value.length > 0,
		),
	)
}

const resolveWritePath = (preferred: string | undefined): string => {
	if (preferred) {
		return preferred
	}

	const envHome = process.env.CODEX_HOME
	if (envHome) {
		return path.join(envHome, AUTH_FILENAME)
	}

	return path.join(os.homedir(), ".codex", AUTH_FILENAME)
}

const toAuthFile = (input: Record<string, unknown>): AuthFile => {
	const auth: AuthFile = { ...input }
	const tokensValue = input.tokens

	if (typeof input.OPENAI_API_KEY === "string" && input.OPENAI_API_KEY) {
		auth.OPENAI_API_KEY = input.OPENAI_API_KEY
	} else {
		delete auth.OPENAI_API_KEY
	}

	if (isRecord(tokensValue) && Object.keys(tokensValue).length > 0) {
		auth.tokens = {
			id_token:
				typeof tokensValue.id_token === "string"
					? tokensValue.id_token
					: undefined,
			access_token:
				typeof tokensValue.access_token === "string"
					? tokensValue.access_token
					: undefined,
			refresh_token:
				typeof tokensValue.refresh_token === "string"
					? tokensValue.refresh_token
					: undefined,
			account_id:
				typeof tokensValue.account_id === "string"
					? tokensValue.account_id
					: undefined,
		}
	} else {
		delete auth.tokens
	}

	if (typeof input.last_refresh === "string" && input.last_refresh) {
		auth.last_refresh = input.last_refresh
	} else {
		delete auth.last_refresh
	}

	return auth
}

const readAuthFile = async (candidates: string[]): Promise<AuthReadResult> => {
	for (const candidate of candidates) {
		try {
			const content = await fs.readFile(candidate, "utf-8")
			const parsed = JSON.parse(content)
			if (isRecord(parsed)) {
				return { path: candidate, data: toAuthFile(parsed) }
			}
			throw new Error(`Auth file at ${candidate} must contain a JSON object.`)
		} catch (error) {
			if (
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				continue
			}
			if (error instanceof SyntaxError) {
				throw new Error(`Auth file at ${candidate} is not valid JSON.`, {
					cause: error,
				})
			}
			throw error
		}
	}

	return {}
}

const ensureDirectory = async (filePath: string): Promise<void> => {
	await fs.mkdir(path.dirname(filePath), { recursive: true })
}

const writeAuthFile = async (
	filePath: string,
	data: AuthFile,
): Promise<void> => {
	await ensureDirectory(filePath)
	await fs.writeFile(filePath, JSON.stringify(data, null, 2), {
		encoding: "utf-8",
		mode: 0o600,
	})
}

export const resolveCodexAuthFilePath = (authFilePath?: string): string => {
	if (authFilePath) {
		return authFilePath
	}

	const codexHome = process.env.CODEX_HOME
	return path.join(
		codexHome ?? path.join(os.homedir(), ".codex"),
		AUTH_FILENAME,
	)
}

export const saveAuthTokens = async (
	options: SaveAuthTokensOptions,
): Promise<SavedAuthTokens> => {
	const filePath = resolveCodexAuthFilePath(options.authFilePath)
	const existing = (await readAuthFile([filePath])).data ?? {}
	const now = options.now ?? (() => new Date())
	const savedAt = now().toISOString()
	const accountId =
		options.token.accountId ??
		deriveAccountId(options.token.idToken) ??
		deriveAccountId(options.token.accessToken)

	if (!accountId) {
		throw new Error(
			"ChatGPT account id not found in OpenAI OAuth token response.",
		)
	}

	await writeAuthFile(filePath, {
		...existing,
		auth_mode: "chatgpt",
		tokens: {
			id_token: options.token.idToken,
			access_token: options.token.accessToken,
			refresh_token: options.token.refreshToken,
			account_id: accountId,
		},
		last_refresh: savedAt,
	})

	return {
		path: filePath,
		auth: {
			accessToken: options.token.accessToken,
			accountId,
			isFedRamp: options.token.isFedRamp,
			idToken: options.token.idToken,
			refreshToken: options.token.refreshToken,
			sourcePath: filePath,
			lastRefresh: savedAt,
		},
	}
}

const refreshChatGptTokens = async (
	refreshToken: string,
	clientId: string | undefined,
	issuer: string | undefined,
	tokenUrl: string | undefined,
	fetchFn: FetchFunction,
): Promise<RefreshOutcome> => {
	const refreshed = await refreshOpenAIOAuthTokens({
		refreshToken,
		clientId,
		issuer,
		tokenUrl,
		fetch: fetchFn,
	})

	return {
		accessToken: refreshed.accessToken,
		idToken: refreshed.idToken,
		refreshToken: refreshed.refreshToken ?? refreshToken,
		accountId: refreshed.accountId,
		isFedRamp: refreshed.isFedRamp,
	}
}

const normalizeTokens = (tokens: StoredTokens | undefined): StoredTokens => {
	const maybeString = (value: unknown): string | undefined =>
		typeof value === "string" && value.length > 0 ? value : undefined

	return {
		id_token: maybeString(tokens?.id_token),
		access_token: maybeString(tokens?.access_token),
		refresh_token: maybeString(tokens?.refresh_token),
		account_id: maybeString(tokens?.account_id),
	}
}

export const loadAuthTokens = async (
	options: AuthLoaderOptions,
): Promise<EffectiveAuth> => {
	const {
		clientId,
		issuer,
		tokenUrl,
		authFilePath,
		fetch,
		ensureFresh = true,
		now = () => new Date(),
	} = options

	if (typeof fetch !== "function") {
		throw new Error(
			"A fetch implementation is required to refresh ChatGPT tokens.",
		)
	}

	const readResult = await readAuthFile(resolveAuthFileCandidates(authFilePath))
	const authData = readResult.data ?? {}
	const tokens = normalizeTokens(authData.tokens)

	let accessToken = tokens.access_token
	let idToken = tokens.id_token
	let refreshToken = tokens.refresh_token
	let accountId = tokens.account_id ?? deriveAccountId(idToken)
	let isFedRamp =
		deriveChatGptAccountIsFedRamp(idToken) ||
		deriveChatGptAccountIsFedRamp(accessToken)
	let lastRefresh = authData.last_refresh

	const needsRefresh =
		ensureFresh &&
		typeof refreshToken === "string" &&
		shouldRefreshAccessToken(accessToken, lastRefresh, now())

	if (needsRefresh && typeof refreshToken === "string") {
		const refreshed = await refreshChatGptTokens(
			refreshToken,
			clientId,
			issuer,
			tokenUrl,
			fetch,
		)

		accessToken = refreshed.accessToken
		idToken = refreshed.idToken ?? idToken
		refreshToken = refreshed.refreshToken ?? refreshToken
		accountId = refreshed.accountId ?? accountId
		isFedRamp =
			isFedRamp ||
			refreshed.isFedRamp === true ||
			deriveChatGptAccountIsFedRamp(idToken) ||
			deriveChatGptAccountIsFedRamp(accessToken)
		lastRefresh = now().toISOString()

		const writePath = resolveWritePath(readResult.path ?? authFilePath)
		await writeAuthFile(writePath, {
			...authData,
			auth_mode: "chatgpt",
			tokens: {
				id_token: idToken,
				access_token: accessToken,
				refresh_token: refreshToken,
				account_id: accountId,
			},
			last_refresh: lastRefresh,
		})
	}

	if (typeof accessToken !== "string" || accessToken.length === 0) {
		throw new Error(
			"ChatGPT access token not found. Run `npx openai-oauth login` to sign in.",
		)
	}

	if (typeof accountId !== "string" || accountId.length === 0) {
		throw new Error(
			"ChatGPT account id not found in auth.json. Run `npx openai-oauth login` to sign in again.",
		)
	}

	return {
		accessToken,
		accountId,
		isFedRamp,
		idToken,
		refreshToken,
		sourcePath: readResult.path ?? resolveWritePath(authFilePath),
		lastRefresh,
	}
}
