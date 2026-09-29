import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { createOpenAIOAuthFetchHandler } from "../src/index.js"

test("preserves optional Agent isolation and explicit strictness on both chat paths", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "oauth-strict-"))
	const authFilePath = path.join(root, "auth.json")
	await fs.writeFile(
		authFilePath,
		JSON.stringify({ tokens: { access_token: "fake", account_id: "fake" } }),
	)
	try {
		for (const stream of [false, true]) {
			for (const strict of [undefined, false, true]) {
				const parameters = {
					type: "object",
					properties: {
						prompt: { type: "string" },
						isolation: { type: "string", enum: ["worktree", "remote"] },
					},
					required: strict ? ["prompt", "isolation"] : ["prompt"],
					additionalProperties: false,
				}
				let captured: Record<string, unknown> | undefined
				const handler = createOpenAIOAuthFetchHandler({
					authFilePath,
					ensureFresh: false,
					codexVersion: "0.144.1",
					models: ["gpt-6-astra"],
					fetch: async (input, init) => {
						if (String(input).includes("/models?"))
							return Response.json({ models: [{ slug: "gpt-6-astra" }] })
						captured = JSON.parse(String(init?.body))
						const response = {
							id: "resp_1",
							model: "gpt-6-astra",
							created_at: 1,
							status: "completed",
							output: [],
							usage: { input_tokens: 1, output_tokens: 1 },
						}
						return new Response(
							`data: ${JSON.stringify({ type: "response.completed", response })}\n\n`,
							{ headers: { "Content-Type": "text/event-stream" } },
						)
					},
				})
				const response = await handler(
					new Request("http://localhost/v1/chat/completions", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							model: "gpt-6-astra",
							stream,
							messages: [
								{
									role: "user",
									content: "Start a local agent; omit isolation.",
								},
							],
							tools: [
								{
									type: "function",
									function: { name: "Agent", parameters, strict },
								},
							],
						}),
					}),
				)
				expect(response.status).toBe(200)
				await response.text()
				expect(captured?.tools).toEqual([
					{
						type: "function",
						name: "Agent",
						parameters,
						strict: strict ?? false,
					},
				])
			}
		}
	} finally {
		// Only remove the exact temporary fixture created above.
		await fs.unlink(authFilePath)
		await fs.rmdir(root)
	}
})
