import { errorMessage } from "../../lib/openai"
import { listWorkspace, removeWorkspacePath } from "../../lib/workspace"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
	const url = new URL(request.url)
	const sessionId = url.searchParams.get("sessionId")?.trim()
	if (!sessionId) {
		return Response.json({ error: "`sessionId` is required." }, { status: 400 })
	}

	try {
		const entries = await listWorkspace(
			sessionId,
			url.searchParams.get("path") ?? ".",
		)
		return Response.json(
			{ entries },
			{ headers: { "cache-control": "no-store" } },
		)
	} catch (error) {
		return Response.json({ error: errorMessage(error) }, { status: 400 })
	}
}

export async function DELETE(request: Request) {
	const url = new URL(request.url)
	const sessionId = url.searchParams.get("sessionId")?.trim()
	const target = url.searchParams.get("path")?.trim()
	if (!sessionId || !target) {
		return Response.json(
			{ error: "`sessionId` and `path` are required." },
			{ status: 400 },
		)
	}

	try {
		return Response.json({
			deleted: await removeWorkspacePath(sessionId, target),
		})
	} catch (error) {
		return Response.json({ error: errorMessage(error) }, { status: 400 })
	}
}
