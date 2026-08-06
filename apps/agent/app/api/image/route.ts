import { createOpenAIOAuth } from "@openai-oauth/ai-sdk"
import { generateImage } from "ai"
import {
	errorMessage,
	isAuthError,
	providerCredentials,
} from "../../lib/openai"
import { IMAGE_MODEL } from "../../lib/tools"
import { writeWorkspaceFile } from "../../lib/workspace"

export const maxDuration = 120

type ImageRequestBody = {
	prompt?: string
	sessionId?: string
	size?: "1024x1024" | "1024x1536" | "1536x1024"
}

const slugify = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 48) || "image"

export async function POST(request: Request) {
	const body = (await request.json().catch(() => ({}))) as ImageRequestBody
	const prompt = body.prompt?.trim()
	const sessionId = body.sessionId?.trim()
	if (!prompt || !sessionId) {
		return Response.json(
			{ error: "`prompt` and `sessionId` are required." },
			{ status: 400 },
		)
	}

	try {
		const openai = createOpenAIOAuth(providerCredentials(request))
		const result = await generateImage({
			model: openai.image(IMAGE_MODEL),
			prompt,
			...(body.size ? { size: body.size } : {}),
		})

		const extension = result.image.mediaType.split("/")[1] ?? "png"
		const saved = await writeWorkspaceFile(
			sessionId,
			`images/${slugify(prompt)}-${Date.now()}.${extension}`,
			result.image.uint8Array,
		)

		return Response.json({
			path: saved.relative,
			mediaType: result.image.mediaType,
			bytes: saved.bytes,
			prompt,
		})
	} catch (error) {
		return Response.json(
			{ error: errorMessage(error) },
			{ status: isAuthError(error) ? 401 : 502 },
		)
	}
}
