import { createOpenAIOAuth } from "@openai-oauth/ai-sdk"
import { generateText } from "ai"
import { errorMessage, providerCredentials } from "../../lib/openai"
import { TITLE_PROMPT } from "../../lib/prompt"

export const maxDuration = 60

type TitleRequestBody = {
	model?: string
	prompt?: string
	reply?: string
}

export async function POST(request: Request) {
	const body = (await request.json().catch(() => ({}))) as TitleRequestBody
	const prompt = body.prompt?.trim()
	if (!prompt || !body.model) {
		return Response.json(
			{ error: "`prompt` and `model` are required." },
			{ status: 400 },
		)
	}

	try {
		const openai = createOpenAIOAuth(providerCredentials(request))
		const { text } = await generateText({
			model: openai(body.model),
			system: TITLE_PROMPT,
			prompt: [prompt, body.reply?.slice(0, 600)]
				.filter(Boolean)
				.join("\n\n---\n\n")
				.slice(0, 2000),
		})

		const title = text
			.replace(/^["'`\s]+|["'`\s.]+$/g, "")
			.split("\n")[0]
			?.slice(0, 60)

		return Response.json({ title: title || "New chat" })
	} catch (error) {
		return Response.json({ error: errorMessage(error) }, { status: 502 })
	}
}
