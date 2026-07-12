import { isRecord } from "./utils.js"

export const CODEX_IMAGE_MODEL = "gpt-image-2"

const MAX_REFERENCE_IMAGES = 5
const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024
const unsupportedOptions = [
	"input_fidelity",
	"moderation",
	"output_compression",
	"output_format",
	"partial_images",
] as const

export type PreparedCodexImageRequest = {
	body: BodyInit | null | undefined
	response?: Response
}

const errorResponse = (message: string): Response =>
	Response.json(
		{
			error: {
				message,
				type: "invalid_request_error",
			},
		},
		{ status: 400 },
	)

const bytesToBase64 = (bytes: Uint8Array): string => {
	let binary = ""
	const chunkSize = 0x8000
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
	}
	return btoa(binary)
}

const fileToDataUrl = async (file: Blob): Promise<string> => {
	const bytes = new Uint8Array(await file.arrayBuffer())
	return `data:${file.type || "image/png"};base64,${bytesToBase64(bytes)}`
}

const decodeBody = async (
	body: BodyInit | null | undefined,
): Promise<string | undefined> => {
	if (typeof body === "string") return body
	if (body instanceof Blob) return body.text()
	if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
	if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body)
	return undefined
}

const normalizeGeneration = (
	body: Record<string, unknown>,
): PreparedCodexImageRequest => {
	if (body.stream === true) {
		return {
			body: undefined,
			response: errorResponse(
				"Streaming image generation is not supported by ChatGPT OAuth.",
			),
		}
	}
	if (typeof body.prompt !== "string" || body.prompt.length === 0) {
		return {
			body: undefined,
			response: errorResponse("`prompt` must be a non-empty string."),
		}
	}
	const unsupported = unsupportedOptions.find((key) => body[key] !== undefined)
	if (unsupported) {
		return {
			body: undefined,
			response: errorResponse(
				`\`${unsupported}\` is not supported by ChatGPT OAuth image generation.`,
			),
		}
	}
	if (
		body.response_format !== undefined &&
		body.response_format !== "b64_json"
	) {
		return {
			body: undefined,
			response: errorResponse(
				"ChatGPT OAuth image generation only returns `b64_json`.",
			),
		}
	}

	const normalized: Record<string, unknown> = {
		model:
			typeof body.model === "string" && body.model.length > 0
				? body.model
				: CODEX_IMAGE_MODEL,
		prompt: body.prompt,
	}
	for (const key of ["background", "n", "quality", "size"] as const) {
		if (body[key] !== undefined) normalized[key] = body[key]
	}

	return { body: JSON.stringify(normalized) }
}

const normalizeEdit = async (
	body: FormData,
): Promise<PreparedCodexImageRequest> => {
	if (body.get("stream") === "true") {
		return {
			body: undefined,
			response: errorResponse(
				"Streaming image editing is not supported by ChatGPT OAuth.",
			),
		}
	}
	if (body.has("mask")) {
		return {
			body: undefined,
			response: errorResponse(
				"Image masks are not supported by ChatGPT OAuth.",
			),
		}
	}

	const prompt = body.get("prompt")
	if (typeof prompt !== "string" || prompt.length === 0) {
		return {
			body: undefined,
			response: errorResponse("`prompt` must be a non-empty string."),
		}
	}

	const files = [...body.getAll("image"), ...body.getAll("image[]")].filter(
		(value): value is File => typeof value !== "string",
	)
	if (files.length === 0 || files.length > MAX_REFERENCE_IMAGES) {
		return {
			body: undefined,
			response: errorResponse(
				files.length === 0
					? "At least one `image` is required."
					: "ChatGPT OAuth supports at most 5 reference images.",
			),
		}
	}
	const oversized = files.find((file) => file.size > MAX_REFERENCE_IMAGE_BYTES)
	if (oversized) {
		return {
			body: undefined,
			response: errorResponse(
				`Reference image \`${oversized.name}\` exceeds the 50 MB limit.`,
			),
		}
	}
	const unsupported = unsupportedOptions.find((key) => body.has(key))
	if (unsupported) {
		return {
			body: undefined,
			response: errorResponse(
				`\`${unsupported}\` is not supported by ChatGPT OAuth image editing.`,
			),
		}
	}
	const responseFormat = body.get("response_format")
	if (responseFormat !== null && responseFormat !== "b64_json") {
		return {
			body: undefined,
			response: errorResponse(
				"ChatGPT OAuth image editing only returns `b64_json`.",
			),
		}
	}

	const model = body.get("model")
	const normalized: Record<string, unknown> = {
		images: await Promise.all(
			files.map(async (file) => ({ image_url: await fileToDataUrl(file) })),
		),
		model: typeof model === "string" && model ? model : CODEX_IMAGE_MODEL,
		prompt,
	}
	const n = body.get("n")
	if (typeof n === "string" && n) {
		const parsed = Number(n)
		if (Number.isFinite(parsed)) normalized.n = parsed
	}
	for (const key of ["background", "quality", "size"] as const) {
		const value = body.get(key)
		if (typeof value === "string" && value) normalized[key] = value
	}

	return { body: JSON.stringify(normalized) }
}

export const prepareCodexImageRequest = async (
	pathname: string,
	headers: Headers,
	body: BodyInit | null | undefined,
): Promise<PreparedCodexImageRequest> => {
	if (pathname.endsWith("/images/generations")) {
		const bodyText = await decodeBody(body)
		if (bodyText === undefined) {
			return {
				body: undefined,
				response: errorResponse(
					"Image generation requires a JSON request body.",
				),
			}
		}
		try {
			const parsed = JSON.parse(bodyText)
			if (!isRecord(parsed)) {
				return {
					body: undefined,
					response: errorResponse(
						"Image generation request body must be a JSON object.",
					),
				}
			}
			headers.set("content-type", "application/json")
			return normalizeGeneration(parsed)
		} catch {
			return {
				body: undefined,
				response: errorResponse("Image generation request is invalid JSON."),
			}
		}
	}

	if (pathname.endsWith("/images/edits")) {
		if (!(body instanceof FormData)) {
			return {
				body: undefined,
				response: errorResponse(
					"Image editing requires a multipart/form-data request body.",
				),
			}
		}
		headers.set("content-type", "application/json")
		return normalizeEdit(body)
	}

	return { body }
}
