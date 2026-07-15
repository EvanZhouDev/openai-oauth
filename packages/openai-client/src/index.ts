import {
	createOpenAIOAuthTransport,
	type OpenAIOAuth,
	type OpenAIOAuthTransport,
} from "@openai-oauth/core"

export type OpenAIClientOptions = {
	apiKey: string
	baseURL: string
	fetch: typeof fetch
	defaultHeaders?: HeadersInit
	dangerouslyAllowBrowser?: boolean
}

export type CreateOpenAIClientOptions = {
	apiKey?: string
	baseURL?: string
	defaultHeaders?: HeadersInit
	dangerouslyAllowBrowser?: boolean
}

export type OpenAIClientInput = OpenAIOAuthTransport | OpenAIOAuth

const isTransport = (input: OpenAIClientInput): input is OpenAIOAuthTransport =>
	input.kind === "openai-compatible"

const toTransport = (input: OpenAIClientInput): OpenAIOAuthTransport => {
	if (isTransport(input)) {
		return input
	}

	return createOpenAIOAuthTransport({
		auth: () => input.getSession(),
		baseURL: input.baseURL,
		fetch: input.fetch,
		headers: input.headers,
		instructions: input.instructions,
		openAIBaseURL: input.openAIBaseURL,
	})
}

export const createOpenAIOptions = (
	input: OpenAIClientInput,
	options: CreateOpenAIClientOptions = {},
): OpenAIClientOptions => {
	const transport = toTransport(input)
	const clientOptions: OpenAIClientOptions = {
		apiKey: options.apiKey ?? "openai-oauth",
		baseURL: options.baseURL ?? transport.baseURL,
		fetch: transport.fetch,
		defaultHeaders: options.defaultHeaders,
	}
	if (options.dangerouslyAllowBrowser !== undefined) {
		clientOptions.dangerouslyAllowBrowser = options.dangerouslyAllowBrowser
	}
	return clientOptions
}
