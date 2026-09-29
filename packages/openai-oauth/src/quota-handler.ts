import { deriveAccountDetails, type OpenAIOAuth } from "@openai-oauth/core"
import { toErrorResponse, toJsonResponse } from "./shared.js"

export const handleQuotaRequest = async (
	auth: OpenAIOAuth,
	resolveModels: () => Promise<string[]>,
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
		const models = await resolveModels()
		const plan = details.subscription.planType

		const isPlusOrTeam =
			plan === "plus" || plan === "team" || plan === "enterprise"
		const flagshipLimit = isPlusOrTeam ? 40 : 10
		const miniLimit = isPlusOrTeam ? 500 : 100

		const modelQuotas: Record<
			string,
			{
				remaining_requests: number
				limit: number
				resets_in_seconds: number
			}
		> = {}

		for (const modelId of models) {
			const isMini = modelId.includes("mini") || modelId.includes("nano")
			const limit = isMini ? miniLimit : flagshipLimit
			modelQuotas[modelId] = {
				remaining_requests: limit,
				limit,
				resets_in_seconds: 10800,
			}
		}

		return toJsonResponse({
			object: "quota",
			account_email: details.user.email,
			plan_type: details.subscription.planType,
			models: modelQuotas,
			capabilities: {
				supports_vision: true,
				supports_image_generation: models.some((m) => m.includes("image")),
				supports_reasoning_traces: true,
				supports_tool_calling: true,
			},
		})
	} catch (error) {
		return toErrorResponse(
			error instanceof Error ? error.message : "Failed to load quota status.",
			500,
			"server_error",
		)
	}
}
