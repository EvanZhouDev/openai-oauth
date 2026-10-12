import { openaiAuthHeaders } from "@openai-oauth/react"
import type { ImageAttachment } from "./images"
import { isRecord, parseJson, readNumber, readString } from "./sse"

export type ImageSize = "auto" | "1024x1024" | "1024x1536" | "1536x1024"
export type ImageQuality = "auto" | "low" | "medium" | "high"
export type ImageBackground = "auto" | "opaque" | "transparent"

export type GeneratedImage = {
	id: string
	dataUrl: string
}

export type ImageGenerationOptions = {
	prompt: string
	model: string
	size: ImageSize
	quality: ImageQuality
	background: ImageBackground
	count: number
	referenceImages: ImageAttachment[]
	signal: AbortSignal
}

export type ImageUsage = {
	input?: number
	output?: number
	total?: number
}

export type ImageGenerationResult = {
	endpoint: "images/generations" | "images/edits"
	requestBody: unknown
	responsePayload: unknown
	images: GeneratedImage[]
	usage?: ImageUsage
}

const endpointPath = {
	"images/generations": "/api/v1/images/generations",
	"images/edits": "/api/v1/images/edits",
} as const

export const imageEndpointLabel = {
	"images/generations": "/v1/images/generations",
	"images/edits": "/v1/images/edits",
} as const

const newId = (): string => `gen_${globalThis.crypto.randomUUID().slice(0, 8)}`

const toRequestError = async (response: Response): Promise<string> => {
	const text = await response.text()
	const parsed = parseJson(text)
	if (isRecord(parsed) && isRecord(parsed.error)) {
		const message = readString(parsed.error, "message")
		if (message) {
			return message
		}
	}
	return text || `Request failed with HTTP ${response.status}.`
}

const toUsage = (value: unknown): ImageUsage | undefined => {
	if (!isRecord(value)) {
		return undefined
	}
	return {
		input: readNumber(value, "input_tokens"),
		output: readNumber(value, "output_tokens"),
		total: readNumber(value, "total_tokens"),
	}
}

const toGeneratedImages = (payload: unknown): GeneratedImage[] => {
	if (!isRecord(payload) || !Array.isArray(payload.data)) {
		return []
	}

	return payload.data
		.filter((entry): entry is Record<string, unknown> => isRecord(entry))
		.map((entry) => readString(entry, "b64_json"))
		.filter((b64): b64 is string => typeof b64 === "string")
		.map((b64) => ({ id: newId(), dataUrl: `data:image/png;base64,${b64}` }))
}

const attachmentToBlob = async (image: ImageAttachment): Promise<Blob> =>
	(await fetch(image.dataUrl)).blob()

export const runImageGeneration = async (
	options: ImageGenerationOptions,
): Promise<ImageGenerationResult> => {
	const isEdit = options.referenceImages.length > 0
	const endpoint = isEdit ? "images/edits" : "images/generations"

	if (!isEdit) {
		const body = {
			model: options.model,
			prompt: options.prompt,
			size: options.size,
			quality: options.quality,
			background: options.background,
			n: options.count,
		}

		const response = await fetch(endpointPath[endpoint], {
			method: "POST",
			headers: {
				...(await openaiAuthHeaders()),
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: options.signal,
		})
		if (!response.ok) {
			throw new Error(await toRequestError(response))
		}

		const payload: unknown = await response.json()
		return {
			endpoint,
			requestBody: body,
			responsePayload: payload,
			images: toGeneratedImages(payload),
			usage: toUsage(isRecord(payload) ? payload.usage : undefined),
		}
	}

	const form = new FormData()
	form.set("prompt", options.prompt)
	form.set("model", options.model)
	form.set("size", options.size)
	form.set("quality", options.quality)
	form.set("background", options.background)
	form.set("n", String(options.count))
	for (const image of options.referenceImages) {
		form.append("image", await attachmentToBlob(image), image.name)
	}

	const response = await fetch(endpointPath[endpoint], {
		method: "POST",
		// No Content-Type: fetch derives the multipart boundary from the
		// FormData body itself, and setting one here would break parsing.
		headers: await openaiAuthHeaders(),
		body: form,
		signal: options.signal,
	})
	if (!response.ok) {
		throw new Error(await toRequestError(response))
	}

	const payload: unknown = await response.json()
	return {
		endpoint,
		requestBody: {
			prompt: options.prompt,
			model: options.model,
			size: options.size,
			quality: options.quality,
			background: options.background,
			n: options.count,
			images: options.referenceImages.map((image) => image.name),
		},
		responsePayload: payload,
		images: toGeneratedImages(payload),
		usage: toUsage(isRecord(payload) ? payload.usage : undefined),
	}
}
