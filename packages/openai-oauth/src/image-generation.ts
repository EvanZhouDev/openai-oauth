import {
	type CodexOAuthClient,
	iterateServerSentEvents,
} from "../../openai-oauth-core/src/index.js"
import { isRecord } from "./shared.js"

export type ImageGenerationRequest = {
	model?: string
	prompt: string
	n?: number
	size?: string
	quality?: string
	background?: string
	output_format?: string
	images?: string[]
}

export type GeneratedImage = {
	b64_json: string
	revised_prompt?: string
}

export type ImageGenerationResponse = {
	created: number
	data: GeneratedImage[]
}

export type ImageGenerationGateway = {
	generate: (
		request: ImageGenerationRequest,
	) => Promise<ImageGenerationResponse>
}

const DEFAULT_IMAGE_MODEL = "gpt-5.4"
const DEFAULT_IMAGE_SIZE = "1024x1024"
const DEFAULT_IMAGE_QUALITY = "low"
const MAX_IMAGE_COUNT = 10
const MAX_REFERENCE_IMAGE_COUNT = 10
const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp);base64,/i

export const normalizeReferenceImages = (images: string[] = []): string[] =>
	images.map((image) =>
		IMAGE_DATA_URL_PATTERN.test(image)
			? image
			: `data:image/png;base64,${image}`,
	)

export const isValidReferenceImages = (value: unknown): value is string[] => {
	if (value === undefined) {
		return true
	}

	if (!Array.isArray(value) || value.length > MAX_REFERENCE_IMAGE_COUNT) {
		return false
	}

	return value.every((image) => typeof image === "string" && image.length > 0)
}

const toResponsesInput = (prompt: string, images?: string[]) => {
	const content: Record<string, unknown>[] = normalizeReferenceImages(
		images,
	).map((image) => ({
		type: "input_image",
		image_url: image,
	}))

	content.push({
		type: "input_text",
		text: prompt,
	})

	return [
		{
			role: "user",
			content,
		},
	]
}

const toImageGenerationTool = (request: ImageGenerationRequest) => {
	const tool: Record<string, unknown> = {
		type: "image_generation",
		size: request.size ?? DEFAULT_IMAGE_SIZE,
		quality: request.quality ?? DEFAULT_IMAGE_QUALITY,
	}

	if (typeof request.background === "string") {
		tool.background = request.background
	}

	if (typeof request.output_format === "string") {
		tool.output_format = request.output_format
	}

	return tool
}

const parsePartialImage = (value: unknown): string | undefined => {
	if (!isRecord(value) || typeof value.partial_image_b64 !== "string") {
		return undefined
	}

	return value.partial_image_b64
}

const parseFinalImage = (value: unknown): string | undefined => {
	if (!isRecord(value)) {
		return undefined
	}

	const result = value.result
	if (typeof result === "string") {
		return result
	}

	if (typeof value.image_b64 === "string") {
		return value.image_b64
	}

	if (typeof value.b64_json === "string") {
		return value.b64_json
	}

	return undefined
}

const readGeneratedImages = async (
	stream: ReadableStream<Uint8Array>,
): Promise<string[]> => {
	const images: string[] = []
	let latestPartialImage: string | undefined

	for await (const event of iterateServerSentEvents(stream)) {
		if (typeof event.data !== "string" || event.data.length === 0) {
			continue
		}

		try {
			const parsed = JSON.parse(event.data)
			const finalImage = parseFinalImage(
				isRecord(parsed) && isRecord(parsed.item) ? parsed.item : parsed,
			)

			if (finalImage) {
				images.push(finalImage)
				latestPartialImage = undefined
				continue
			}

			const partialImage = parsePartialImage(parsed)
			if (partialImage) {
				latestPartialImage = partialImage
			}
		} catch {}
	}

	if (images.length > 0) {
		return images
	}

	return latestPartialImage ? [latestPartialImage] : []
}

export class CodexResponsesImageGenerationGateway
	implements ImageGenerationGateway
{
	constructor(private readonly client: CodexOAuthClient) {}

	async generate(
		request: ImageGenerationRequest,
	): Promise<ImageGenerationResponse> {
		const count = Math.min(
			MAX_IMAGE_COUNT,
			Math.max(1, Math.floor(request.n ?? 1)),
		)
		const images: string[] = []

		for (let index = 0; index < count; index += 1) {
			const upstream = await this.client.request("/responses", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: request.model ?? DEFAULT_IMAGE_MODEL,
					stream: true,
					input: toResponsesInput(request.prompt, request.images),
					tools: [toImageGenerationTool(request)],
				}),
			})

			if (!upstream.ok) {
				throw new Error(await upstream.text())
			}

			if (upstream.body == null) {
				throw new Error("Image generation response did not include a body.")
			}

			images.push(...(await readGeneratedImages(upstream.body)))
		}

		if (images.length === 0) {
			throw new Error("Image generation completed without image data.")
		}

		return {
			created: Math.floor(Date.now() / 1000),
			data: images.map((image) => ({
				b64_json: image,
				revised_prompt: request.prompt,
			})),
		}
	}
}
