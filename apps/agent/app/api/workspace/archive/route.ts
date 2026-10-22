import { errorMessage } from "../../../lib/openai"
import { listWorkspace, readWorkspaceBinary } from "../../../lib/workspace"
import { createZip, type ZipEntry } from "../../../lib/zip"

export const dynamic = "force-dynamic"

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024

/** Downloads everything the agent built in a conversation as a single zip. */
export async function GET(request: Request) {
	const url = new URL(request.url)
	const sessionId = url.searchParams.get("sessionId")?.trim()
	if (!sessionId) {
		return Response.json({ error: "`sessionId` is required." }, { status: 400 })
	}

	try {
		const files = (await listWorkspace(sessionId)).filter(
			(entry) => entry.type === "file",
		)
		if (files.length === 0) {
			return Response.json(
				{ error: "This workspace is empty." },
				{ status: 404 },
			)
		}

		const entries: ZipEntry[] = []
		let total = 0
		for (const file of files) {
			const { buffer } = await readWorkspaceBinary(sessionId, file.path)
			total += buffer.byteLength
			if (total > MAX_ARCHIVE_BYTES) {
				break
			}
			entries.push({
				path: file.path,
				data: buffer,
				modifiedAt: new Date(file.modifiedAt),
			})
		}

		const archive = createZip(entries)
		return new Response(Uint8Array.from(archive), {
			headers: {
				"content-type": "application/zip",
				"content-disposition": `attachment; filename="workspace-${sessionId}.zip"`,
				"cache-control": "no-store",
			},
		})
	} catch (error) {
		return Response.json({ error: errorMessage(error) }, { status: 400 })
	}
}
