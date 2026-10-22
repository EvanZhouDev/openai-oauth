import path from "node:path"
import { errorMessage } from "../../lib/openai"
import { isProbablyText, writeWorkspaceFile } from "../../lib/workspace"

export const maxDuration = 60

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const TEXT_PREVIEW_CHARS = 4_000

const safeName = (name: string): string => {
	const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_")
	return base.length > 0 ? base.slice(0, 80) : `upload-${Date.now()}`
}

/** Saves an attachment straight into the conversation workspace. */
export async function POST(request: Request) {
	try {
		const form = await request.formData()
		const sessionId = String(form.get("sessionId") ?? "").trim()
		const file = form.get("file")

		if (!sessionId || !(file instanceof File)) {
			return Response.json(
				{ error: "`sessionId` and `file` are required." },
				{ status: 400 },
			)
		}
		if (file.size > MAX_UPLOAD_BYTES) {
			return Response.json(
				{ error: `"${file.name}" is larger than the 25 MB upload limit.` },
				{ status: 413 },
			)
		}

		const buffer = Buffer.from(await file.arrayBuffer())
		const name = safeName(file.name)
		const target = `uploads/${Date.now().toString(36)}-${name}`
		const saved = await writeWorkspaceFile(sessionId, target, buffer)
		const mediaType = file.type || "application/octet-stream"
		const isImage = mediaType.startsWith("image/")
		const isText = !isImage && isProbablyText(name, buffer)

		return Response.json({
			path: saved.relative,
			name,
			mediaType,
			bytes: saved.bytes,
			isImage,
			isText,
			preview: isText
				? buffer.subarray(0, TEXT_PREVIEW_CHARS).toString("utf8")
				: undefined,
		})
	} catch (error) {
		return Response.json({ error: errorMessage(error) }, { status: 500 })
	}
}
