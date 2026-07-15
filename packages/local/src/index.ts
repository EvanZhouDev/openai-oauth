import type {
	FetchFunction,
	OpenAIOAuth,
	OpenAIOAuthSession,
} from "@openai-oauth/core"
import {
	type AuthLoaderOptions,
	type EffectiveAuth,
	loadAuthTokens,
} from "./auth-file.js"

export type LocalOpenAIOAuthOptions = Omit<AuthLoaderOptions, "fetch"> & {
	fetch?: FetchFunction
	baseURL?: string
	headers?: Record<string, string>
	instructions?: string
	openAIBaseURL?: string
}

const pickFetch = (customFetch?: FetchFunction): FetchFunction => {
	if (typeof customFetch === "function") {
		return customFetch
	}
	if (typeof globalThis.fetch === "function") {
		return globalThis.fetch.bind(globalThis)
	}
	throw new Error("A fetch implementation is required for local credentials.")
}

const toSession = (auth: EffectiveAuth): OpenAIOAuthSession => ({
	accessToken: auth.accessToken,
	accountId: auth.accountId,
	isFedRamp: auth.isFedRamp,
	idToken: auth.idToken,
	refreshToken: auth.refreshToken,
	lastRefresh: auth.lastRefresh,
})

export const openaiCredentials = (
	options: LocalOpenAIOAuthOptions = {},
): OpenAIOAuth => ({
	kind: "openai-oauth",
	baseURL: options.baseURL,
	fetch: options.fetch,
	headers: options.headers,
	instructions: options.instructions,
	openAIBaseURL: options.openAIBaseURL,
	getSession: async () =>
		toSession(
			await loadAuthTokens({
				authFilePath: options.authFilePath,
				clientId: options.clientId,
				ensureFresh: options.ensureFresh,
				fetch: pickFetch(options.fetch),
				issuer: options.issuer,
				now: options.now,
				tokenUrl: options.tokenUrl,
			}),
		),
})
