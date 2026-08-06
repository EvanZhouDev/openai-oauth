import { constants } from "node:fs"
import {
	access,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises"
import path from "node:path"

/**
 * Every conversation gets its own directory on disk. The agent can only ever
 * touch files inside that directory: each path is resolved, symlink-expanded
 * and then checked against the session root before any fs call runs.
 */
export const WORKSPACE_ROOT =
	process.env.AGENT_WORKSPACE_ROOT ??
	path.join(process.cwd(), ".agent-workspace")

const MAX_READ_BYTES = 512 * 1024
const MAX_WRITE_BYTES = 4 * 1024 * 1024
const MAX_TREE_ENTRIES = 400
const MAX_TREE_DEPTH = 6

const IGNORED_DIRECTORIES = new Set([
	".cache",
	".git",
	".next",
	".turbo",
	".venv",
	"__pycache__",
	"dist",
	"node_modules",
	"target",
	"venv",
])

const TEXT_EXTENSIONS = new Set([
	".c",
	".cjs",
	".conf",
	".cpp",
	".cs",
	".css",
	".csv",
	".env",
	".go",
	".h",
	".hpp",
	".html",
	".ini",
	".java",
	".js",
	".json",
	".jsx",
	".kt",
	".log",
	".lua",
	".md",
	".mjs",
	".php",
	".py",
	".rb",
	".rs",
	".scss",
	".sh",
	".sql",
	".svg",
	".swift",
	".toml",
	".ts",
	".tsx",
	".txt",
	".vue",
	".xml",
	".yaml",
	".yml",
])

export type WorkspaceEntry = {
	path: string
	type: "file" | "directory"
	size: number
	modifiedAt: number
}

export class WorkspaceError extends Error {}

const sanitizeSessionId = (sessionId: string): string => {
	const cleaned = sessionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)
	if (cleaned.length === 0) {
		throw new WorkspaceError("Invalid session id.")
	}
	return cleaned
}

/** Creates (once) and returns the absolute directory for a conversation. */
export const sessionRoot = async (sessionId: string): Promise<string> => {
	const root = path.join(WORKSPACE_ROOT, sanitizeSessionId(sessionId))
	await mkdir(root, { recursive: true })
	return await realpath(root)
}

const isInside = (root: string, target: string): boolean =>
	target === root || target.startsWith(`${root}${path.sep}`)

/**
 * Resolves a relative path against the session root, refusing anything that
 * escapes it — including via `..` segments, absolute paths, or a symlink that
 * points outside the sandbox.
 */
export const resolveInWorkspace = async (
	sessionId: string,
	relativePath: string,
): Promise<{ root: string; absolute: string; relative: string }> => {
	const root = await sessionRoot(sessionId)
	const trimmed = (relativePath ?? "").trim()
	if (trimmed.length === 0 || trimmed === "." || trimmed === "./") {
		return { root, absolute: root, relative: "." }
	}
	if (trimmed.includes("\0")) {
		throw new WorkspaceError("Path contains an invalid character.")
	}

	const candidate = path.resolve(root, trimmed.replace(/^\/+/, ""))
	if (!isInside(root, candidate)) {
		throw new WorkspaceError(
			`Path "${relativePath}" is outside the sandbox workspace.`,
		)
	}

	// Expand symlinks on the deepest part of the path that already exists so a
	// link planted inside the sandbox cannot be used to reach out of it.
	let existing = candidate
	while (existing !== root) {
		try {
			await access(existing, constants.F_OK)
			break
		} catch {
			existing = path.dirname(existing)
		}
	}
	const realExisting = await realpath(existing)
	if (!isInside(root, realExisting)) {
		throw new WorkspaceError(
			`Path "${relativePath}" resolves outside the sandbox workspace.`,
		)
	}

	return {
		root,
		absolute: candidate,
		relative: path.relative(root, candidate) || ".",
	}
}

export const isProbablyText = (filePath: string, sample: Buffer): boolean => {
	if (TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
		return true
	}
	if (sample.length === 0) {
		return true
	}
	if (sample.includes(0)) {
		return false
	}
	let suspicious = 0
	for (const byte of sample.subarray(0, 512)) {
		if (byte < 7 || (byte > 13 && byte < 32)) {
			suspicious += 1
		}
	}
	return suspicious / Math.min(sample.length, 512) < 0.1
}

export const listWorkspace = async (
	sessionId: string,
	subPath = ".",
): Promise<WorkspaceEntry[]> => {
	const { root, absolute } = await resolveInWorkspace(sessionId, subPath)
	const entries: WorkspaceEntry[] = []

	const walk = async (directory: string, depth: number): Promise<void> => {
		if (depth > MAX_TREE_DEPTH || entries.length >= MAX_TREE_ENTRIES) {
			return
		}
		let dirEntries: string[]
		try {
			dirEntries = await readdir(directory)
		} catch {
			return
		}

		for (const name of dirEntries.sort()) {
			if (entries.length >= MAX_TREE_ENTRIES) {
				return
			}
			const child = path.join(directory, name)
			let info: Awaited<ReturnType<typeof stat>>
			try {
				info = await stat(child)
			} catch {
				continue
			}
			const isDirectory = info.isDirectory()
			if (isDirectory && IGNORED_DIRECTORIES.has(name)) {
				continue
			}
			entries.push({
				path: path.relative(root, child),
				type: isDirectory ? "directory" : "file",
				size: isDirectory ? 0 : info.size,
				modifiedAt: info.mtimeMs,
			})
			if (isDirectory) {
				await walk(child, depth + 1)
			}
		}
	}

	await walk(absolute, 1)
	return entries
}

export const readWorkspaceFile = async (
	sessionId: string,
	filePath: string,
): Promise<{ relative: string; content: string; truncated: boolean }> => {
	const { absolute, relative } = await resolveInWorkspace(sessionId, filePath)
	const info = await stat(absolute).catch(() => null)
	if (!info) {
		throw new WorkspaceError(`File "${filePath}" does not exist.`)
	}
	if (info.isDirectory()) {
		throw new WorkspaceError(`"${filePath}" is a directory, not a file.`)
	}

	const buffer = await readFile(absolute)
	if (!isProbablyText(absolute, buffer)) {
		throw new WorkspaceError(
			`"${filePath}" looks like a binary file and cannot be read as text.`,
		)
	}

	const truncated = buffer.byteLength > MAX_READ_BYTES
	return {
		relative,
		content: buffer.subarray(0, MAX_READ_BYTES).toString("utf8"),
		truncated,
	}
}

export const readWorkspaceBinary = async (
	sessionId: string,
	filePath: string,
): Promise<{ relative: string; buffer: Buffer }> => {
	const { absolute, relative } = await resolveInWorkspace(sessionId, filePath)
	const info = await stat(absolute).catch(() => null)
	if (!info || info.isDirectory()) {
		throw new WorkspaceError(`File "${filePath}" does not exist.`)
	}
	return { relative, buffer: await readFile(absolute) }
}

export const writeWorkspaceFile = async (
	sessionId: string,
	filePath: string,
	content: string | Uint8Array,
): Promise<{ relative: string; bytes: number; created: boolean }> => {
	const { absolute, relative } = await resolveInWorkspace(sessionId, filePath)
	if (relative === ".") {
		throw new WorkspaceError("Refusing to overwrite the workspace root.")
	}
	const bytes =
		typeof content === "string"
			? Buffer.byteLength(content)
			: content.byteLength
	if (bytes > MAX_WRITE_BYTES) {
		throw new WorkspaceError(
			`File is too large to write (${bytes} bytes, limit ${MAX_WRITE_BYTES}).`,
		)
	}

	const existed = await stat(absolute)
		.then(() => true)
		.catch(() => false)
	await mkdir(path.dirname(absolute), { recursive: true })
	await writeFile(absolute, content)
	return { relative, bytes, created: !existed }
}

export const editWorkspaceFile = async (
	sessionId: string,
	filePath: string,
	find: string,
	replaceWith: string,
	replaceAll: boolean,
): Promise<{ relative: string; replacements: number }> => {
	const { absolute, relative } = await resolveInWorkspace(sessionId, filePath)
	const original = await readFile(absolute, "utf8").catch(() => null)
	if (original === null) {
		throw new WorkspaceError(`File "${filePath}" does not exist.`)
	}
	if (find.length === 0) {
		throw new WorkspaceError("`find` must not be empty.")
	}

	const occurrences = original.split(find).length - 1
	if (occurrences === 0) {
		throw new WorkspaceError(
			`Could not find the given text in "${filePath}". Read the file again and match it exactly.`,
		)
	}
	if (occurrences > 1 && !replaceAll) {
		throw new WorkspaceError(
			`Found ${occurrences} matches in "${filePath}". Add more surrounding context or set replace_all.`,
		)
	}

	const updated = replaceAll
		? original.split(find).join(replaceWith)
		: original.replace(find, replaceWith)
	await writeFile(absolute, updated)
	return { relative, replacements: replaceAll ? occurrences : 1 }
}

export const createWorkspaceDirectory = async (
	sessionId: string,
	directoryPath: string,
): Promise<string> => {
	const { absolute, relative } = await resolveInWorkspace(
		sessionId,
		directoryPath,
	)
	await mkdir(absolute, { recursive: true })
	return relative
}

export const removeWorkspacePath = async (
	sessionId: string,
	targetPath: string,
): Promise<string> => {
	const { absolute, relative } = await resolveInWorkspace(sessionId, targetPath)
	if (relative === ".") {
		throw new WorkspaceError("Refusing to delete the workspace root.")
	}
	await rm(absolute, { recursive: true, force: true })
	return relative
}

export const moveWorkspacePath = async (
	sessionId: string,
	fromPath: string,
	toPath: string,
): Promise<{ from: string; to: string }> => {
	const source = await resolveInWorkspace(sessionId, fromPath)
	const destination = await resolveInWorkspace(sessionId, toPath)
	if (source.relative === "." || destination.relative === ".") {
		throw new WorkspaceError("Refusing to move the workspace root.")
	}
	await mkdir(path.dirname(destination.absolute), { recursive: true })
	await rename(source.absolute, destination.absolute)
	return { from: source.relative, to: destination.relative }
}

/** A short, human readable summary of the sandbox contents for the prompt. */
export const workspaceOutline = async (sessionId: string): Promise<string> => {
	const entries = await listWorkspace(sessionId).catch(() => [])
	if (entries.length === 0) {
		return "(empty)"
	}
	return entries
		.slice(0, 60)
		.map((entry) =>
			entry.type === "directory" ? `${entry.path}/` : entry.path,
		)
		.join("\n")
}
