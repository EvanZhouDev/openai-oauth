import type { OpenAIOAuthTransport } from "@openai-oauth/core"
import { copyUpstreamResponse } from "./shared.js"

const FORWARDED_HEADERS = ["originator", "x-codex-turn-metadata"]

export const handleWebSearchRequest = async (
	request: Request,
	client: OpenAIOAuthTransport,
): Promise<Response> => {
	const headers = new Headers({ "Content-Type": "application/json" })
	for (const name of FORWARDED_HEADERS) {
		const value = request.headers.get(name)
		if (value !== null) {
			headers.set(name, value)
		}
	}

	const upstream = await client.request("/alpha/search", {
		method: "POST",
		headers,
		body: await request.text(),
		signal: request.signal,
	})
	return copyUpstreamResponse(upstream)
}
