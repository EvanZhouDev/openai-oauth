import {
	fallbackCatalog,
	fetchModelCatalog,
	pickDefaultModel,
	resolveCodexClientVersion,
} from "../../lib/models"
import {
	errorMessage,
	isAuthError,
	transportFromRequest,
} from "../../lib/openai"

export const dynamic = "force-dynamic"

/**
 * Live model list. Nothing is cached on the server, so reloading the page is
 * enough to pick up a model OpenAI has just started serving this account.
 */
export async function GET(request: Request) {
	try {
		const catalog = await fetchModelCatalog(transportFromRequest(request))
		return Response.json(
			{ ...catalog, defaultModel: pickDefaultModel(catalog.models) },
			{ headers: { "cache-control": "no-store" } },
		)
	} catch (error) {
		// Signed out is worth reporting; anything else should still leave the app
		// usable, so fall back to the models the Codex client itself ships with.
		if (isAuthError(error)) {
			return Response.json({ error: errorMessage(error) }, { status: 401 })
		}

		const catalog = fallbackCatalog(await resolveCodexClientVersion())
		return Response.json(
			{
				...catalog,
				defaultModel: pickDefaultModel(catalog.models),
				warning: `Could not read the model list from your account (${errorMessage(error)}). Showing the known model list instead.`,
			},
			{ headers: { "cache-control": "no-store" } },
		)
	}
}
