import { fetchModelCatalog, pickDefaultModel } from "../../lib/models"
import {
	errorMessage,
	isAuthError,
	transportFromRequest,
} from "../../lib/openai"

export const dynamic = "force-dynamic"

/**
 * Live model list. Nothing is cached on the server, so reloading the page is
 * enough to pick up a model OpenAI has just started testing.
 */
export async function GET(request: Request) {
	try {
		const catalog = await fetchModelCatalog(transportFromRequest(request))
		return Response.json(
			{ ...catalog, defaultModel: pickDefaultModel(catalog.models) },
			{ headers: { "cache-control": "no-store" } },
		)
	} catch (error) {
		return Response.json(
			{ error: errorMessage(error) },
			{ status: isAuthError(error) ? 401 : 502 },
		)
	}
}
