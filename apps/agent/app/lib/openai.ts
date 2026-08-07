import {
	createOpenAIOAuthTransport,
	type OpenAIOAuthSession,
	type OpenAIOAuthTransport,
} from "@openai-oauth/core"
import { openaiCredentials } from "@openai-oauth/react/server"

/**
 * Points the provider at a different Codex-compatible upstream. Empty in
 * normal use; set it to run against a local proxy or a stub during tests.
 */
const codexBaseURL = process.env.CODEX_BASE_URL || undefined

/**
 * Every request from the browser carries the visitor's own ChatGPT OAuth
 * token, so the server never stores credentials — it just forwards them.
 */
export const sessionFromRequest = (
	request: Request,
): (() => Promise<OpenAIOAuthSession>) => {
	const credentials = openaiCredentials(request, { baseURL: codexBaseURL })
	return async () => {
		const session = await credentials.getSession()
		if (!session) {
			throw new Error("Not signed in with ChatGPT.")
		}
		return session
	}
}

export const transportFromRequest = (request: Request): OpenAIOAuthTransport =>
	createOpenAIOAuthTransport({
		auth: sessionFromRequest(request),
		baseURL: codexBaseURL,
	})

/** Credentials for the AI SDK provider, honouring the base URL override. */
export const providerCredentials = (request: Request) =>
	openaiCredentials(request, { baseURL: codexBaseURL })

export const isAuthError = (error: unknown): boolean => {
	const message = error instanceof Error ? error.message : String(error)
	return (
		message.includes("Not signed in") ||
		message.includes("must include `Authorization`") ||
		message.includes("session not found")
	)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null

/** Digs the upstream explanation out of an API error body when there is one. */
const upstreamDetail = (body: string): string | undefined => {
	try {
		const parsed: unknown = JSON.parse(body)
		if (isRecord(parsed)) {
			if (isRecord(parsed.error) && typeof parsed.error.message === "string") {
				return parsed.error.message
			}
			if (typeof parsed.detail === "string") {
				return parsed.detail
			}
			if (typeof parsed.message === "string") {
				return parsed.message
			}
		}
	} catch {}
	return body.trim().length > 0 ? body.slice(0, 400) : undefined
}

/**
 * A message worth showing a user. API errors carry the reason in the response
 * body, which is the difference between "an error occurred" and knowing that a
 * parameter was rejected.
 */
export const errorMessage = (error: unknown): string => {
	if (!(error instanceof Error)) {
		return String(error)
	}

	const candidate = error as Error & {
		responseBody?: unknown
		statusCode?: unknown
	}
	const detail =
		typeof candidate.responseBody === "string"
			? upstreamDetail(candidate.responseBody)
			: undefined

	if (detail && !error.message.includes(detail)) {
		const status =
			typeof candidate.statusCode === "number"
				? ` (${candidate.statusCode})`
				: ""
		return `${error.message}${status}: ${detail}`
	}
	return error.message
}
