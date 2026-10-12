export type ImageAttachment = {
	id: string
	name: string
	mediaType: string
	dataUrl: string
	width: number
	height: number
}

export const MAX_ATTACHMENTS = 4
const MAX_SOURCE_BYTES = 24 * 1024 * 1024
// Matches the longest-side guidance OpenAI vision models are tuned for; also
// keeps the base64 payload well under a serverless function's body limit.
const MAX_DIMENSION = 1568
const JPEG_QUALITY = 0.85

const newId = (): string => `img_${globalThis.crypto.randomUUID().slice(0, 8)}`

/**
 * Downscales large photos before they become base64 JSON payloads. PNGs
 * (likely screenshots or graphics with transparency) are kept as PNG; every
 * other format is re-encoded as JPEG, which is far smaller for photos.
 */
const encode = (
	canvas: HTMLCanvasElement,
	sourceType: string,
): { dataUrl: string; mediaType: string } => {
	if (sourceType === "image/png") {
		return { dataUrl: canvas.toDataURL("image/png"), mediaType: "image/png" }
	}
	return {
		dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
		mediaType: "image/jpeg",
	}
}

const toBitmap = async (file: File): Promise<ImageBitmap> => {
	try {
		return await createImageBitmap(file)
	} catch {
		throw new Error(`"${file.name}" could not be read as an image.`)
	}
}

export const readImageFile = async (file: File): Promise<ImageAttachment> => {
	if (!file.type.startsWith("image/")) {
		throw new Error(`"${file.name}" is not an image.`)
	}
	if (file.size > MAX_SOURCE_BYTES) {
		throw new Error(
			`"${file.name}" is larger than ${Math.round(MAX_SOURCE_BYTES / (1024 * 1024))}MB.`,
		)
	}

	const bitmap = await toBitmap(file)
	try {
		const scale = Math.min(
			1,
			MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
		)
		const width = Math.max(1, Math.round(bitmap.width * scale))
		const height = Math.max(1, Math.round(bitmap.height * scale))

		const canvas = document.createElement("canvas")
		canvas.width = width
		canvas.height = height
		const context = canvas.getContext("2d")
		if (!context) {
			throw new Error("This browser cannot resize images.")
		}
		context.drawImage(bitmap, 0, 0, width, height)

		const { dataUrl, mediaType } = encode(canvas, file.type)
		return { id: newId(), name: file.name, mediaType, dataUrl, width, height }
	} finally {
		bitmap.close()
	}
}

export const readImageFiles = async (
	files: FileList | File[],
): Promise<{ attachments: ImageAttachment[]; errors: string[] }> => {
	const attachments: ImageAttachment[] = []
	const errors: string[] = []

	for (const file of Array.from(files)) {
		try {
			attachments.push(await readImageFile(file))
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error))
		}
	}

	return { attachments, errors }
}
