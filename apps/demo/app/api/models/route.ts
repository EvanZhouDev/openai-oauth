import { createOpenAIOAuthTransport } from "@openai-oauth/core"
import { openaiCredentials } from "@openai-oauth/react/server"

export async function GET(request: Request) {
	try {
		const auth = openaiCredentials(request)
		const transport = createOpenAIOAuthTransport({
			auth: () => auth.getSession(),
		})
		const response = await transport.fetch(
			"https://openai-oauth.local/v1/models",
		)
		const data = (await response.json()) as unknown
		return Response.json(data)
	} catch (error) {
		return Response.json(
			{
				error: error instanceof Error ? error.message : "Failed to load models",
			},
			{ status: 400 },
		)
	}
}
