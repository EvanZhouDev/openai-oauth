import { createOpenAIOAuth } from "@openai-oauth/ai-sdk"
import { openaiCredentials } from "@openai-oauth/react/server"
import { generateImage } from "ai"

export async function POST(request: Request) {
	const { prompt } = (await request.json()) as { prompt?: string }
	const openai = createOpenAIOAuth(openaiCredentials(request))

	const result = await generateImage({
		model: openai.image("gpt-image-2"),
		prompt: prompt ?? "",
	})

	return new Response(Uint8Array.from(result.image.uint8Array), {
		headers: { "Content-Type": result.image.mediaType },
	})
}
