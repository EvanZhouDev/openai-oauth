import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { FetchFunction } from "@ai-sdk/provider-utils"

const DEFAULT_CLIENT_ID =
	process.env.CHATGPT_LOCAL_CLIENT_ID ?? "app_EMoamEEZ73f0CkXaXp7hrann"
const DEFAULT_ISSUER =
	process.env.CHATGPT_LOCAL_ISSUER ?? "https://auth.openai.com"
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
	OPENAI_API_KEY?: string
	tokens?: StoredTokens
	last_refresh?: string
}

export type EffectiveAuth = {
	accessToken: string
	accountId: string
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

type AuthReadResult = {
	path?: string
	data?: AuthFile
}

type RefreshOutcome = {
	accessToken: string
	idToken?: string
	refreshToken?: string
	accountId?: string
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

const decodeBase64Url = (value: string): string | undefined => {
	try {
		const padded = value + "=".repeat(((-value.length % 4) + 4) % 4)
		const buffer = Buffer.from(padded, "base64url")
		return buffer.toString("utf-8")
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
	return undefined
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

	const envHome = process.env.CHATGPT_LOCAL_HOME
	const codexHome = process.env.CODEX_HOME

	return uniquePaths(
		[
			authFilePath,
			envHome ? path.join(envHome, AUTH_FILENAME) : undefined,
			codexHome ? path.join(codexHome, AUTH_FILENAME) : undefined,
			path.join(os.homedir(), ".chatgpt-local", AUTH_FILENAME),
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

	const envHome = process.env.CHATGPT_LOCAL_HOME ?? process.env.CODEX_HOME
	if (envHome) {
		return path.join(envHome, AUTH_FILENAME)
	}

	return path.join(os.homedir(), ".chatgpt-local", AUTH_FILENAME)
}

const toAuthFile = (input: Record<string, unknown>): AuthFile => {
	const auth: AuthFile = {}
	const tokensValue = input.tokens

	if (typeof input.OPENAI_API_KEY === "string" && input.OPENAI_API_KEY) {
		auth.OPENAI_API_KEY = input.OPENAI_API_KEY
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
	}

	if (typeof input.last_refresh === "string" && input.last_refresh) {
		auth.last_refresh = input.last_refresh
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
		} catch {}
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

const refreshChatGptTokens = async (
	refreshToken: string,
	clientId: string,
	issuer: string,
	tokenUrl: string | undefined,
	fetchFn: FetchFunction,
): Promise<RefreshOutcome | undefined> => {
	const resolvedTokenUrl =
		tokenUrl ?? `${issuer.replace(/\/$/, "")}/oauth/token`
	const response = await fetchFn(resolvedTokenUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: clientId,
			scope: "openid profile email offline_access",
		}),
	})

	if (!response.ok) {
		return undefined
	}

	const payload = await response.json()
	if (!isRecord(payload)) {
		return undefined
	}

	const refreshedAccessToken =
		typeof payload.access_token === "string" ? payload.access_token : undefined
	if (!refreshedAccessToken) {
		return undefined
	}

	const refreshedIdToken =
		typeof payload.id_token === "string" ? payload.id_token : undefined
	const refreshedRefreshToken =
		typeof payload.refresh_token === "string"
			? payload.refresh_token
			: refreshToken

	return {
		accessToken: refreshedAccessToken,
		idToken: refreshedIdToken,
		refreshToken: refreshedRefreshToken,
		accountId: deriveAccountId(refreshedIdToken),
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
		clientId = DEFAULT_CLIENT_ID,
		issuer = DEFAULT_ISSUER,
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

		if (refreshed) {
			accessToken = refreshed.accessToken
			idToken = refreshed.idToken ?? idToken
			refreshToken = refreshed.refreshToken ?? refreshToken
			accountId = refreshed.accountId ?? accountId
			lastRefresh = now().toISOString()

			const writePath = resolveWritePath(readResult.path ?? authFilePath)
			await writeAuthFile(writePath, {
				...authData,
				tokens: {
					id_token: idToken,
					access_token: accessToken,
					refresh_token: refreshToken,
					account_id: accountId,
				},
				last_refresh: lastRefresh,
			})
		}
	}

	if (typeof accessToken !== "string" || accessToken.length === 0) {
		throw new Error(
			"ChatGPT access token not found. Run `codex login` to create auth.json.",
		)
	}

	if (typeof accountId !== "string" || accountId.length === 0) {
		throw new Error(
			"ChatGPT account id not found in auth.json. Run `codex login` to create auth.json.",
		)
	}

	return {
		accessToken,
		accountId,
		idToken,
		refreshToken,
		sourcePath: readResult.path ?? resolveWritePath(authFilePath),
		lastRefresh,
	}
}
