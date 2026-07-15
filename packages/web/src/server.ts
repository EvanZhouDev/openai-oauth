import type {
	FetchFunction,
	OpenAIOAuth,
	OpenAIOAuthSession,
} from "@openai-oauth/core"

export type WebServerOpenAIOAuthOptions = {
	baseURL?: string
	fetch?: FetchFunction
	headers?: Record<string, string>
	instructions?: string
	openAIBaseURL?: string
}

const getHeaders = (input: Request | Headers): Headers =>
	input instanceof Headers ? input : input.headers

const getBearerToken = (headers: Headers): string | undefined => {
	const authorization = headers.get("authorization")
	const match = authorization?.match(/^Bearer\s+(.+)$/i)
	return match?.[1]
}

const getRequestSession = (input: Request | Headers): OpenAIOAuthSession => {
	const headers = getHeaders(input)
	const accessToken = getBearerToken(headers)
	const accountId = headers.get("chatgpt-account-id") ?? undefined

	if (!accessToken || !accountId) {
		throw new Error(
			"OpenAI OAuth request headers must include `Authorization` and `chatgpt-account-id`.",
		)
	}

	return {
		accessToken,
		accountId,
		isFedRamp: headers.get("x-openai-fedramp") === "true",
	}
}

export const openaiCredentials = (
	input: Request | Headers,
	options: WebServerOpenAIOAuthOptions = {},
): OpenAIOAuth => {
	const session = getRequestSession(input)

	return {
		kind: "openai-oauth",
		baseURL: options.baseURL,
		fetch: options.fetch,
		headers: options.headers,
		instructions: options.instructions,
		openAIBaseURL: options.openAIBaseURL,
		getSession: async () => session,
	}
}
