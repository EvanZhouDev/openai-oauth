import {
	createOpenAIOAuthRequest,
	deriveAccountId,
	exchangeOpenAIOAuthCode,
	type FetchFunction,
	type OpenAIOAuthRequestOptions,
	type OpenAIOAuthSession,
	type OpenAIOAuthTokenResponse,
	parseJwtClaims,
	refreshOpenAIOAuthTokens,
	type SessionStore,
} from "@openai-oauth/core"

export type { OpenAIOAuthSession, SessionStore }

export type BrowserSessionStoreOptions = {
	dbName?: string
	storeName?: string
	sessionKey?: string
	cryptoKey?: string
}

export type OpenAIOAuthTokenOptions = {
	clientId?: string
	issuer?: string
	tokenUrl?: string
	fetch?: FetchFunction
	now?: () => Date
}

export type ExchangeCodeOptions = OpenAIOAuthTokenOptions

export type ExchangeCodeInput = {
	code: string
	codeVerifier: string
	redirectUri: string
	signal?: AbortSignal
}

export type RefreshSessionOptions = OpenAIOAuthTokenOptions

export type RefreshSessionInput = {
	refreshToken: string
	signal?: AbortSignal
}

export type BrowserSessionOptions = {
	sessionStore?: SessionStore
	clientId?: string
	issuer?: string
	tokenUrl?: string
	fetch?: FetchFunction
	refresh?: boolean
	now?: () => Date
}

export type OpenAIAuthHeadersOptions = BrowserSessionOptions & {
	headers?: HeadersInit
	optional?: boolean
}

export type OpenAIAuthHeaders = Record<string, string>

export type StartLoginOptions = Omit<
	OpenAIOAuthRequestOptions,
	"redirectUri"
> & {
	callbackPath?: string
	redirectUri?: string
	returnTo?: string
	openMode?: "redirect" | "popup"
}

export type CompleteLoginOptions = {
	sessionStore?: SessionStore
	clientId?: string
	issuer?: string
	tokenUrl?: string
	fetch?: FetchFunction
	now?: () => Date
	url?: string
}

export type LogoutOptions = {
	sessionStore?: SessionStore
}

type StoreSettings = Required<BrowserSessionStoreOptions>

type StoredRecord<T> = {
	id: string
	value: T
}

type EncryptedSession = {
	iv: string
	ciphertext: string
}

type PendingLogin = {
	state: string
	codeVerifier: string
	redirectUri: string
	returnTo: string
}

const defaultStoreSettings: StoreSettings = {
	dbName: "openai-oauth",
	storeName: "sessions",
	sessionKey: "openai-oauth:session",
	cryptoKey: "openai-oauth:crypto-key",
}

const pendingLoginKey = "openai-oauth:pending-login"
const browserExtensionStatePrefix = "oo2_"
const browserExtensionRedirectUri = "http://localhost:1455/auth/callback"
const browserExtensionId = "odbgboachaefbbbdiffcefhpkekhfcna"
const browserExtensionInstalledPath = "src/installed.json"
const chromeExtensionInstallUrl =
	"https://chromewebstore.google.com/detail/sign-in-with-chatgpt/odbgboachaefbbbdiffcefhpkekhfcna"
const firefoxExtensionInstallUrl =
	"https://addons.mozilla.org/firefox/addon/sign-in-with-chatgpt/"
const firefoxExtensionDetectionUrl =
	"http://localhost:1455/openai-oauth/installed"
const browserExtensionMarkerType = "openai-oauth:browser-extension-installed"
const browserExtensionDetectionTimeoutMs = 750
const refreshExpiryMarginMs = 5 * 60 * 1000
const refreshIntervalMs = 55 * 60 * 1000

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const assertBrowserStorage = (): void => {
	if (
		typeof indexedDB === "undefined" ||
		typeof globalThis.crypto?.subtle === "undefined"
	) {
		throw new Error("Browser session storage requires IndexedDB and WebCrypto.")
	}
}

const assertBrowserWindow = (): Window => {
	if (typeof window === "undefined") {
		throw new Error("OpenAI OAuth browser login requires window.")
	}
	return window
}

const isFirefox = (): boolean =>
	typeof navigator !== "undefined" &&
	navigator.userAgent.toLowerCase().includes("firefox/")

const isChromeExtensionInstalled = async (): Promise<boolean> => {
	const fetchImpl = globalThis.fetch
	if (!fetchImpl) {
		return false
	}

	const controller =
		typeof AbortController === "undefined" ? null : new AbortController()
	const timeout = controller
		? globalThis.setTimeout(
				() => controller.abort(),
				browserExtensionDetectionTimeoutMs,
			)
		: null

	try {
		const response = await fetchImpl(
			`chrome-extension://${browserExtensionId}/${browserExtensionInstalledPath}`,
			{
				cache: "no-store",
				signal: controller?.signal,
			},
		)
		if (!response.ok) {
			return false
		}

		const marker = (await response.json().catch(() => null)) as {
			installed?: unknown
		} | null
		return marker?.installed === true
	} catch {
		return false
	} finally {
		if (timeout !== null) {
			globalThis.clearTimeout(timeout)
		}
	}
}

const isFirefoxExtensionInstalled = (browserWindow: Window): Promise<boolean> =>
	new Promise((resolve) => {
		const document = browserWindow.document
		const parent = document?.body ?? document?.documentElement
		if (!document?.createElement || !parent) {
			resolve(false)
			return
		}

		const iframe = document.createElement("iframe")
		iframe.hidden = true
		iframe.setAttribute("aria-hidden", "true")
		iframe.src = firefoxExtensionDetectionUrl

		let settled = false
		const finish = (installed: boolean) => {
			if (settled) {
				return
			}
			settled = true
			globalThis.clearTimeout(timeout)
			browserWindow.removeEventListener("message", onMessage)
			iframe.remove()
			resolve(installed)
		}
		const onMessage = (event: MessageEvent) => {
			const data = event.data as {
				name?: unknown
				protocol?: unknown
				protocolVersion?: unknown
				type?: unknown
			} | null
			if (
				event.source === iframe.contentWindow &&
				event.origin.startsWith("moz-extension://") &&
				data?.type === browserExtensionMarkerType &&
				data.name === "sign-in-with-chatgpt" &&
				data.protocol === "openai-oauth-browser-extension" &&
				data.protocolVersion === 1
			) {
				finish(true)
			}
		}
		const timeout = globalThis.setTimeout(
			() => finish(false),
			browserExtensionDetectionTimeoutMs,
		)

		browserWindow.addEventListener("message", onMessage)
		parent.appendChild(iframe)
	})

const getBrowserExtension = (browserWindow: Window) =>
	isFirefox()
		? {
				installUrl: firefoxExtensionInstallUrl,
				isInstalled: () => isFirefoxExtensionInstalled(browserWindow),
			}
		: {
				installUrl: chromeExtensionInstallUrl,
				isInstalled: isChromeExtensionInstalled,
			}

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () =>
			reject(request.error ?? new Error("IndexedDB request failed."))
	})

const transactionToPromise = (transaction: IDBTransaction): Promise<void> =>
	new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve()
		transaction.onerror = () =>
			reject(transaction.error ?? new Error("IndexedDB transaction failed."))
		transaction.onabort = () =>
			reject(
				transaction.error ?? new Error("IndexedDB transaction was aborted."),
			)
	})

const openDatabaseRequest = (
	settings: StoreSettings,
	version?: number,
): Promise<IDBDatabase> => {
	assertBrowserStorage()

	const browserWindow = assertBrowserWindow()
	return new Promise((resolve, reject) => {
		let settled = false
		const timeout = browserWindow.setTimeout(() => {
			settled = true
			reject(new Error("Timed out opening browser session storage."))
		}, 2000)
		const request =
			typeof version === "number"
				? indexedDB.open(settings.dbName, version)
				: indexedDB.open(settings.dbName)
		request.onupgradeneeded = () => {
			const db = request.result
			if (!db.objectStoreNames.contains(settings.storeName)) {
				db.createObjectStore(settings.storeName, { keyPath: "id" })
			}
		}
		request.onsuccess = () => {
			browserWindow.clearTimeout(timeout)
			if (settled) {
				request.result.close()
				return
			}
			settled = true
			resolve(request.result)
		}
		request.onerror = () => {
			browserWindow.clearTimeout(timeout)
			if (settled) return
			settled = true
			reject(request.error ?? new Error("Could not open IndexedDB."))
		}
		request.onblocked = () => {
			browserWindow.clearTimeout(timeout)
			if (settled) return
			settled = true
			reject(new Error("Browser session storage is blocked."))
		}
	})
}

const openDatabase = async (settings: StoreSettings): Promise<IDBDatabase> => {
	const db = await openDatabaseRequest(settings)
	if (db.objectStoreNames.contains(settings.storeName)) {
		return db
	}

	const nextVersion = db.version + 1
	db.close()
	const upgraded = await openDatabaseRequest(settings, nextVersion)
	if (upgraded.objectStoreNames.contains(settings.storeName)) {
		return upgraded
	}

	upgraded.close()
	throw new Error("Browser session storage could not create its object store.")
}

const withStore = async <T>(
	settings: StoreSettings,
	mode: IDBTransactionMode,
	fn: (store: IDBObjectStore) => Promise<T>,
): Promise<T> => {
	const db = await openDatabase(settings)
	try {
		const tx = db.transaction(settings.storeName, mode)
		const completed = transactionToPromise(tx)
		const store = tx.objectStore(settings.storeName)
		try {
			const result = await fn(store)
			await completed
			return result
		} catch (error) {
			try {
				tx.abort()
			} catch {}
			await completed.catch(() => undefined)
			throw error
		}
	} finally {
		db.close()
	}
}

const getRecord = async <T>(
	settings: StoreSettings,
	id: string,
): Promise<T | undefined> =>
	withStore(settings, "readonly", async (store) => {
		const record = await requestToPromise<StoredRecord<T> | undefined>(
			store.get(id),
		)
		return record?.value
	})

const setRecord = async <T>(
	settings: StoreSettings,
	id: string,
	value: T,
): Promise<void> =>
	withStore(settings, "readwrite", async (store) => {
		await requestToPromise(store.put({ id, value }))
	})

const deleteRecord = async (
	settings: StoreSettings,
	id: string,
): Promise<void> =>
	withStore(settings, "readwrite", async (store) => {
		await requestToPromise(store.delete(id))
	})

const bytesToBase64 = (bytes: Uint8Array): string => {
	let binary = ""
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return btoa(binary)
}

const base64ToBytes = (value: string): Uint8Array<ArrayBuffer> => {
	const decoded = atob(value)
	const bytes = new Uint8Array(decoded.length)
	for (let index = 0; index < decoded.length; index += 1) {
		bytes[index] = decoded.charCodeAt(index)
	}
	return bytes
}

const generateCryptoKey = async (): Promise<CryptoKey> => {
	const key = await globalThis.crypto.subtle.generateKey(
		{
			name: "AES-GCM",
			length: 256,
		},
		false,
		["encrypt", "decrypt"],
	)
	return key as CryptoKey
}

const getCryptoKey = async (settings: StoreSettings): Promise<CryptoKey> => {
	const existing = await getRecord<CryptoKey>(settings, settings.cryptoKey)
	if (existing) {
		return existing
	}

	const key = await generateCryptoKey()
	await setRecord(settings, settings.cryptoKey, key)
	return key
}

const encryptSession = async (
	key: CryptoKey,
	session: OpenAIOAuthSession,
): Promise<EncryptedSession> => {
	const iv = new Uint8Array(12)
	globalThis.crypto.getRandomValues(iv)
	const ciphertext = await globalThis.crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv,
		},
		key,
		textEncoder.encode(JSON.stringify(session)),
	)

	return {
		iv: bytesToBase64(iv),
		ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
	}
}

const decryptSession = async (
	key: CryptoKey,
	encrypted: EncryptedSession,
): Promise<OpenAIOAuthSession> => {
	const plaintext = await globalThis.crypto.subtle.decrypt(
		{
			name: "AES-GCM",
			iv: base64ToBytes(encrypted.iv),
		},
		key,
		base64ToBytes(encrypted.ciphertext),
	)
	const session: unknown = JSON.parse(textDecoder.decode(plaintext))
	if (
		typeof session !== "object" ||
		session === null ||
		!("accessToken" in session) ||
		typeof session.accessToken !== "string" ||
		!("accountId" in session) ||
		typeof session.accountId !== "string"
	) {
		throw new Error("The stored OpenAI OAuth session is malformed.")
	}
	return session as OpenAIOAuthSession
}

export const createSessionStore = (
	options: BrowserSessionStoreOptions = {},
): SessionStore => {
	const settings: StoreSettings = {
		...defaultStoreSettings,
		...options,
	}

	return {
		get: async () => {
			const encrypted = await getRecord<EncryptedSession>(
				settings,
				settings.sessionKey,
			)
			if (!encrypted) {
				return null
			}
			if (
				typeof encrypted.iv !== "string" ||
				typeof encrypted.ciphertext !== "string"
			) {
				throw new Error("The stored OpenAI OAuth session is malformed.")
			}
			return decryptSession(await getCryptoKey(settings), encrypted)
		},
		set: async (session) => {
			const key = await getCryptoKey(settings)
			await setRecord(
				settings,
				settings.sessionKey,
				await encryptSession(key, session),
			)
		},
		clear: async () => {
			await deleteRecord(settings, settings.sessionKey)
		},
	}
}

let defaultSessionStore: SessionStore | undefined

const getDefaultSessionStore = (): SessionStore => {
	defaultSessionStore ??= createSessionStore()
	return defaultSessionStore
}

const parseIsoDate = (value: string | undefined): Date | undefined => {
	if (typeof value !== "string" || value.length === 0) {
		return undefined
	}
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? undefined : date
}

const shouldRefreshSession = (
	session: OpenAIOAuthSession,
	now: Date,
): boolean => {
	const expiresAt = parseIsoDate(session.expiresAt)
	if (
		expiresAt &&
		expiresAt.getTime() <= now.getTime() + refreshExpiryMarginMs
	) {
		return true
	}

	const claims = parseJwtClaims(session.accessToken)
	const exp = claims && typeof claims.exp === "number" ? claims.exp : undefined
	if (
		typeof exp === "number" &&
		exp * 1000 <= now.getTime() + refreshExpiryMarginMs
	) {
		return true
	}

	const lastRefresh = parseIsoDate(session.lastRefresh)
	return lastRefresh
		? lastRefresh.getTime() <= now.getTime() - refreshIntervalMs
		: false
}

const toSession = (
	token: OpenAIOAuthTokenResponse,
	options: {
		previousRefreshToken?: string
		now: Date
	},
): OpenAIOAuthSession => {
	const accountId =
		token.accountId ??
		deriveAccountId(token.idToken) ??
		deriveAccountId(token.accessToken)

	if (!accountId) {
		throw new Error(
			"ChatGPT account id not found in OpenAI OAuth token response.",
		)
	}

	return {
		accessToken: token.accessToken,
		accountId,
		isFedRamp: token.isFedRamp,
		idToken: token.idToken,
		refreshToken: token.refreshToken ?? options.previousRefreshToken,
		expiresAt:
			typeof token.expiresIn === "number"
				? new Date(options.now.getTime() + token.expiresIn * 1000).toISOString()
				: undefined,
		lastRefresh: options.now.toISOString(),
	}
}

export const exchangeCode = async (
	input: ExchangeCodeInput,
	options: ExchangeCodeOptions = {},
): Promise<OpenAIOAuthSession> => {
	const token = await exchangeOpenAIOAuthCode({
		code: input.code,
		codeVerifier: input.codeVerifier,
		redirectUri: input.redirectUri,
		clientId: options.clientId,
		issuer: options.issuer,
		tokenUrl: options.tokenUrl,
		fetch: options.fetch,
		signal: input.signal,
	})
	return toSession(token, {
		now: (options.now ?? (() => new Date()))(),
	})
}

export const refreshSession = async (
	input: RefreshSessionInput,
	options: RefreshSessionOptions = {},
): Promise<OpenAIOAuthSession> => {
	const token = await refreshOpenAIOAuthTokens({
		refreshToken: input.refreshToken,
		clientId: options.clientId,
		issuer: options.issuer,
		tokenUrl: options.tokenUrl,
		fetch: options.fetch,
		signal: input.signal,
	})
	return toSession(token, {
		previousRefreshToken: input.refreshToken,
		now: (options.now ?? (() => new Date()))(),
	})
}

export const getSession = async (
	options: BrowserSessionOptions = {},
): Promise<OpenAIOAuthSession | null> => {
	const sessionStore = options.sessionStore ?? getDefaultSessionStore()
	const now = options.now ?? (() => new Date())
	const shouldRefresh = options.refresh ?? true

	const session = await sessionStore.get()
	if (
		!session ||
		!shouldRefresh ||
		!session.refreshToken ||
		!shouldRefreshSession(session, now())
	) {
		return session
	}

	const refreshed = await refreshSession(
		{
			refreshToken: session.refreshToken,
		},
		options,
	)
	const nextSession =
		session.isFedRamp && !refreshed.isFedRamp
			? { ...refreshed, isFedRamp: true }
			: refreshed
	await sessionStore.set(nextSession)
	return nextSession
}

export const openaiAuthHeaders = async (
	options: OpenAIAuthHeadersOptions = {},
): Promise<OpenAIAuthHeaders> => {
	const session = await getSession(options)
	if (!session) {
		if (options.optional) {
			return toPlainHeaders(new Headers(options.headers))
		}
		throw new Error("OpenAI OAuth session not found.")
	}

	const headers = new Headers(options.headers)
	headers.set("Authorization", `Bearer ${session.accessToken}`)
	headers.set("chatgpt-account-id", session.accountId)
	if (session.isFedRamp) {
		headers.set("X-OpenAI-Fedramp", "true")
	}
	return toPlainHeaders(headers)
}

const toPlainHeaders = (headers: Headers): OpenAIAuthHeaders => {
	const output: OpenAIAuthHeaders = {}
	headers.forEach((value, key) => {
		output[key] = value
	})
	return output
}

const readPendingLogin = (): PendingLogin | undefined => {
	const browserWindow = assertBrowserWindow()
	try {
		const value = browserWindow.sessionStorage.getItem(pendingLoginKey)
		return value ? (JSON.parse(value) as PendingLogin) : undefined
	} catch {
		return undefined
	}
}

const writePendingLogin = (pending: PendingLogin): void => {
	assertBrowserWindow().sessionStorage.setItem(
		pendingLoginKey,
		JSON.stringify(pending),
	)
}

const clearPendingLogin = (): void => {
	assertBrowserWindow().sessionStorage.removeItem(pendingLoginKey)
}

const getCurrentRelativeUrl = (): string => {
	const browserWindow = assertBrowserWindow()
	return `${browserWindow.location.pathname}${browserWindow.location.search}${browserWindow.location.hash}`
}

const getDefaultRedirectUri = (callbackPath: string): string =>
	new URL(callbackPath, assertBrowserWindow().location.origin).toString()

const getCurrentUrl = (): string =>
	new URL(
		getCurrentRelativeUrl(),
		assertBrowserWindow().location.origin,
	).toString()

const bytesToBase64Url = (bytes: Uint8Array): string =>
	bytesToBase64(bytes)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "")

const randomURLSafeString = (byteLength: number): string => {
	const bytes = new Uint8Array(byteLength)
	globalThis.crypto.getRandomValues(bytes)
	return bytesToBase64Url(bytes)
}

const encodeBase64Url = (value: string): string =>
	bytesToBase64Url(textEncoder.encode(value))

const createBrowserExtensionState = (
	callbackUrl: string,
	appState?: string,
): string => {
	const payload: Record<string, string | number> = {
		type: "openai-oauth-callback",
		version: 1,
		nonce: randomURLSafeString(24),
		callbackUrl,
	}
	if (appState) {
		payload.appState = appState
	}

	return `${browserExtensionStatePrefix}${encodeBase64Url(JSON.stringify(payload))}`
}

export const startLogin = async (
	options: StartLoginOptions = {},
): Promise<
	{ status: "needs-extension"; installUrl: string } | { status: "started" }
> => {
	const browserWindow = assertBrowserWindow()
	const usesBrowserExtension = options.redirectUri === undefined
	const browserExtension = getBrowserExtension(browserWindow)
	if (usesBrowserExtension && !(await browserExtension.isInstalled())) {
		return {
			status: "needs-extension",
			installUrl: browserExtension.installUrl,
		}
	}

	const returnTo = options.returnTo ?? getCurrentRelativeUrl()
	const callbackUrl = options.callbackPath
		? getDefaultRedirectUri(options.callbackPath)
		: usesBrowserExtension
			? getCurrentUrl()
			: getDefaultRedirectUri("/auth/callback")
	const redirectUri = options.redirectUri ?? browserExtensionRedirectUri
	const request = await createOpenAIOAuthRequest({
		clientId: options.clientId,
		issuer: options.issuer,
		scope: options.scope,
		state: usesBrowserExtension
			? createBrowserExtensionState(callbackUrl, options.state)
			: options.state,
		codeVerifier: options.codeVerifier,
		simplifiedFlow: options.simplifiedFlow,
		idTokenAddOrganizations: options.idTokenAddOrganizations,
		extraParams: options.extraParams,
		redirectUri,
	})

	writePendingLogin({
		state: request.state,
		codeVerifier: request.codeVerifier,
		redirectUri: request.redirectUri,
		returnTo,
	})

	if (options.openMode === "popup") {
		const popup = browserWindow.open(
			request.authorizationUrl,
			"_blank",
			"popup,width=520,height=720",
		)
		if (!popup) {
			throw new Error("The ChatGPT login popup was blocked.")
		}
		return { status: "started" }
	}

	browserWindow.location.assign(request.authorizationUrl)
	return { status: "started" }
}

export const completeLogin = async (
	options: CompleteLoginOptions = {},
): Promise<OpenAIOAuthSession | null> => {
	const browserWindow = assertBrowserWindow()
	const url = new URL(options.url ?? browserWindow.location.href)
	const oauthError = url.searchParams.get("error")
	const code = url.searchParams.get("code")
	const callbackState = url.searchParams.get("state")
	const sessionStore = options.sessionStore ?? getDefaultSessionStore()

	if (!oauthError && !code) {
		return null
	}

	const pending = readPendingLogin()
	if (!pending) {
		const existingSession = await sessionStore.get()
		if (existingSession) {
			browserWindow.history.replaceState(null, "", "/")
			return existingSession
		}
	}

	if (oauthError) {
		if (
			oauthError === "access_denied" &&
			pending &&
			callbackState === pending.state
		) {
			clearPendingLogin()
			browserWindow.history.replaceState(null, "", pending.returnTo || "/")
			return null
		}

		throw new Error(
			url.searchParams.get("error_description") ??
				`OpenAI OAuth returned ${oauthError}.`,
		)
	}

	if (!pending || !callbackState || pending.state !== callbackState) {
		throw new Error("OpenAI OAuth callback state did not match.")
	}

	if (!code) {
		throw new Error("OpenAI OAuth callback did not include a code.")
	}

	const session = await exchangeCode(
		{
			code,
			codeVerifier: pending.codeVerifier,
			redirectUri: pending.redirectUri,
		},
		options,
	)
	await sessionStore.set(session)
	clearPendingLogin()
	browserWindow.history.replaceState(null, "", pending.returnTo || "/")
	return session
}

export const logout = async (options: LogoutOptions = {}): Promise<void> => {
	try {
		clearPendingLogin()
	} catch {}
	await (options.sessionStore ?? getDefaultSessionStore()).clear()
}
