import { createOpenAIOAuth } from "@openai-oauth/ai-sdk"
import { openaiCredentials } from "@openai-oauth/react/server"
import { streamText } from "ai"

export async function POST(request: Request) {
	const { prompt } = (await request.json()) as { prompt?: string }
	const openai = createOpenAIOAuth(openaiCredentials(request))

	const result = streamText({
		model: openai("gpt-5.4-mini"),
		prompt: prompt ?? "",
	})

	return result.toTextStreamResponse()
}
