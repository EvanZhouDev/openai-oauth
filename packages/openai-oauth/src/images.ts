import type { OpenAIOAuthTransport } from "@openai-oauth/core"
import { copyUpstreamResponse, toErrorResponse } from "./shared.js"

export const handleImageGenerationRequest = async (
	request: Request,
	client: OpenAIOAuthTransport,
): Promise<Response> => {
	const upstream = await client.request("/images/generations", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: await request.text(),
		signal: request.signal,
	})
	return copyUpstreamResponse(upstream)
}

export const handleImageEditRequest = async (
	request: Request,
	client: OpenAIOAuthTransport,
): Promise<Response> => {
	if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
		return toErrorResponse(
			"Image editing requires a multipart/form-data request body.",
		)
	}

	let body: FormData
	try {
		body = await request.formData()
	} catch {
		return toErrorResponse("Image editing request contains invalid form data.")
	}

	const upstream = await client.request("/images/edits", {
		method: "POST",
		body,
		signal: request.signal,
	})
	return copyUpstreamResponse(upstream)
}
