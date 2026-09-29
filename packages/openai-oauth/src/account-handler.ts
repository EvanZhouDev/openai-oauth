import { deriveAccountDetails, type OpenAIOAuth } from "@openai-oauth/core"
import { toErrorResponse, toJsonResponse } from "./shared.js"

export const handleAccountRequest = async (
	auth: OpenAIOAuth,
): Promise<Response> => {
	try {
		const session = await auth.getSession()
		if (!session) {
			return toErrorResponse(
				"Authentication required. No active ChatGPT session.",
				401,
				"unauthorized",
			)
		}

		const details = deriveAccountDetails(session.idToken, session.accessToken)
		return toJsonResponse({
			object: "account",
			user: details.user,
			subscription: details.subscription,
			session: details.session,
		})
	} catch (error) {
		return toErrorResponse(
			error instanceof Error ? error.message : "Failed to load account info.",
			500,
			"server_error",
		)
	}
}
