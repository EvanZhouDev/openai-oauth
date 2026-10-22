import path from "node:path"
import { errorMessage } from "../../../lib/openai"
import { readWorkspaceBinary } from "../../../lib/workspace"

export const dynamic = "force-dynamic"

const MEDIA_TYPES: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".csv": "text/csv; charset=utf-8",
	".gif": "image/gif",
	".html": "text/html; charset=utf-8",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".md": "text/markdown; charset=utf-8",
	".pdf": "application/pdf",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".webp": "image/webp",
}

/** Serves a single file out of a conversation workspace (previews, downloads). */
export async function GET(request: Request) {
	const url = new URL(request.url)
	const sessionId = url.searchParams.get("sessionId")?.trim()
	const filePath = url.searchParams.get("path")?.trim()
	if (!sessionId || !filePath) {
		return Response.json(
			{ error: "`sessionId` and `path` are required." },
			{ status: 400 },
		)
	}

	try {
		const file = await readWorkspaceBinary(sessionId, filePath)
		const extension = path.extname(file.relative).toLowerCase()
		const mediaType = MEDIA_TYPES[extension] ?? "application/octet-stream"
		const disposition = url.searchParams.get("download")
			? `attachment; filename="${path.basename(file.relative)}"`
			: "inline"

		return new Response(Uint8Array.from(file.buffer), {
			headers: {
				// HTML from the sandbox is never rendered inline in this origin.
				"content-type":
					extension === ".html" || extension === ".svg"
						? "text/plain; charset=utf-8"
						: mediaType,
				"content-disposition": disposition,
				"cache-control": "no-store",
				"x-content-type-options": "nosniff",
			},
		})
	} catch (error) {
		return Response.json({ error: errorMessage(error) }, { status: 404 })
	}
}
