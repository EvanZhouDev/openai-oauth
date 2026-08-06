import {
	createOpenAIOAuthTransport,
	type OpenAIOAuthSession,
	type OpenAIOAuthTransport,
} from "@openai-oauth/core"
import { openaiCredentials } from "@openai-oauth/react/server"

/**
 * Every request from the browser carries the visitor's own ChatGPT OAuth
 * token, so the server never stores credentials — it just forwards them.
 */
export const sessionFromRequest = (
	request: Request,
): (() => Promise<OpenAIOAuthSession>) => {
	const credentials = openaiCredentials(request)
	return async () => {
		const session = await credentials.getSession()
		if (!session) {
			throw new Error("Not signed in with ChatGPT.")
		}
		return session
	}
}

export const transportFromRequest = (request: Request): OpenAIOAuthTransport =>
	createOpenAIOAuthTransport({ auth: sessionFromRequest(request) })

export const isAuthError = (error: unknown): boolean => {
	const message = error instanceof Error ? error.message : String(error)
	return (
		message.includes("Not signed in") ||
		message.includes("must include `Authorization`") ||
		message.includes("session not found")
	)
}

export const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)
