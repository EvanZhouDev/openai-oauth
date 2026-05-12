import type {
	ImageGenerationGateway,
	ImageGenerationRequest,
} from "./image-generation.js"
import { isRecord, toErrorResponse, toJsonResponse } from "./shared.js"

const isImageGenerationRequest = (
	value: unknown,
): value is ImageGenerationRequest =>
	isRecord(value) && typeof value.prompt === "string" && value.prompt.length > 0

export const handleImagesGenerationsRequest = async (
	request: Request,
	gateway: ImageGenerationGateway,
): Promise<Response> => {
	const body = await request.json()
	if (!isImageGenerationRequest(body)) {
		return toErrorResponse("`prompt` must be a non-empty string.")
	}

	try {
		return toJsonResponse(await gateway.generate(body))
	} catch (error) {
		return toErrorResponse(
			error instanceof Error ? error.message : "Image generation failed.",
			502,
			"upstream_error",
		)
	}
}
