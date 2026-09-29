import { openaiAccountDetails } from "@openai-oauth/react/server"

export async function GET(request: Request) {
	try {
		const account = openaiAccountDetails(request)
		return Response.json(account)
	} catch (error) {
		return Response.json(
			{
				error: error instanceof Error ? error.message : "Unauthorized request",
			},
			{ status: 401 },
		)
	}
}
