import { tool } from "@ai-sdk/provider-utils"
import type { OpenAIOAuthProvider } from "@openai-oauth/ai-sdk"
import { generateImage } from "ai"
import { z } from "zod"
import { fetchPage, webSearch } from "./search"
import { runCommand } from "./terminal"
import {
	editWorkspaceFile,
	listWorkspace,
	readWorkspaceFile,
	removeWorkspacePath,
	writeWorkspaceFile,
} from "./workspace"

export const IMAGE_MODEL = "gpt-image-2"

export type AgentToolContext = {
	sessionId: string
	provider: OpenAIOAuthProvider
	signal?: AbortSignal
}

const planStepSchema = z.object({
	title: z.string().describe("Short imperative description of the step."),
	status: z
		.enum(["pending", "in_progress", "completed"])
		.describe("Where this step stands right now."),
})

/** Single-quote for the shell so URLs and branch names cannot inject. */
const shellQuote = (value: string): string =>
	`'${value.replace(/'/g, "'\\''")}'`

const slugify = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 48) || "image"

export const createAgentTools = ({
	sessionId,
	provider,
	signal,
}: AgentToolContext) => ({
	update_plan: tool({
		description:
			"Record or update the plan for a multi-step task. Call this before starting work and again whenever a step finishes. Keep exactly one step in_progress.",
		inputSchema: z.object({
			steps: z.array(planStepSchema).min(1).max(8),
			note: z
				.string()
				.optional()
				.describe("Optional one-line explanation of a change in direction."),
		}),
		execute: async ({ steps, note }) => ({ steps, note }),
	}),

	list_files: tool({
		description:
			"List files and directories in the sandbox workspace, recursively.",
		inputSchema: z.object({
			path: z
				.string()
				.optional()
				.describe("Directory to list, relative to the workspace root."),
		}),
		execute: async ({ path }) => {
			const entries = await listWorkspace(sessionId, path ?? ".")
			return {
				path: path ?? ".",
				count: entries.length,
				entries: entries.map((entry) => ({
					path: entry.path,
					type: entry.type,
					size: entry.size,
				})),
			}
		},
	}),

	read_file: tool({
		description:
			"Read a UTF-8 text file from the sandbox workspace. Always read before editing.",
		inputSchema: z.object({
			path: z.string().describe("File path relative to the workspace root."),
		}),
		execute: async ({ path }) => {
			const file = await readWorkspaceFile(sessionId, path)
			return {
				path: file.relative,
				truncated: file.truncated,
				lines: file.content.split("\n").length,
				content: file.content,
			}
		},
	}),

	write_file: tool({
		description:
			"Create or overwrite a file in the sandbox workspace. Missing parent directories are created automatically.",
		inputSchema: z.object({
			path: z
				.string()
				.describe(
					"File path relative to the workspace root, e.g. src/main.py or docs/README.md.",
				),
			content: z.string().describe("Full contents of the file."),
		}),
		execute: async ({ path, content }) => {
			const result = await writeWorkspaceFile(sessionId, path, content)
			return {
				path: result.relative,
				bytes: result.bytes,
				created: result.created,
				lines: content.split("\n").length,
			}
		},
	}),

	edit_file: tool({
		description:
			"Replace an exact snippet inside an existing file. The snippet must match the file byte for byte.",
		inputSchema: z.object({
			path: z.string(),
			find: z
				.string()
				.describe("Exact text to replace, with enough context to be unique."),
			replace: z.string().describe("Replacement text."),
			replace_all: z
				.boolean()
				.optional()
				.describe(
					"Replace every occurrence instead of requiring a unique match.",
				),
		}),
		execute: async ({ path, find, replace, replace_all }) => {
			const result = await editWorkspaceFile(
				sessionId,
				path,
				find,
				replace,
				replace_all ?? false,
			)
			return { path: result.relative, replacements: result.replacements }
		},
	}),

	delete_path: tool({
		description: "Delete a file or directory from the sandbox workspace.",
		inputSchema: z.object({ path: z.string() }),
		execute: async ({ path }) => ({
			path: await removeWorkspacePath(sessionId, path),
			deleted: true,
		}),
	}),

	run_command: tool({
		description:
			"Run a shell command in the sandbox terminal, inside the workspace. The sandbox has internet access: use it to execute code, run tests, clone repositories, and install packages (npm, pip, apt-free tools). Long installs need a larger timeout_ms.",
		inputSchema: z.object({
			command: z.string().describe("Shell command, e.g. `python3 main.py`."),
			cwd: z
				.string()
				.optional()
				.describe("Working directory relative to the workspace root."),
			timeout_ms: z
				.number()
				.int()
				.min(1000)
				.max(300000)
				.optional()
				.describe(
					"Kill the command after this many milliseconds (default 60000).",
				),
		}),
		execute: async ({ command, cwd, timeout_ms }) => {
			const result = await runCommand({
				sessionId,
				command,
				cwd,
				timeoutMs: timeout_ms,
				signal,
			})
			const failed = result.timedOut || result.exitCode !== 0
			return {
				...result,
				failed,
				// Spelled out so a failure reads as work to do, not a dead end.
				hint: failed
					? result.timedOut
						? "The command hit its timeout. Re-run it with a larger timeout_ms, or run it in the background and poll."
						: "Non-zero exit. Read stderr above, fix the cause, and run it again. Do not report success until it exits 0."
					: undefined,
			}
		},
	}),

	clone_repo: tool({
		description:
			"Clone a public git repository into the sandbox workspace so its code can be read, run and modified.",
		inputSchema: z.object({
			url: z
				.string()
				.describe("Repository URL, e.g. https://github.com/owner/name."),
			directory: z
				.string()
				.optional()
				.describe(
					"Target directory inside the workspace. Defaults to the repo name.",
				),
			depth: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe("History depth; 0 clones the full history. Defaults to 1."),
			branch: z.string().optional(),
		}),
		execute: async ({ url, directory, depth, branch }) => {
			if (!/^(https?:\/\/|git@)/.test(url)) {
				throw new Error(
					"Only http(s) and git@ repository URLs can be cloned into the sandbox.",
				)
			}

			const target =
				directory?.trim() ||
				(url.split("/").pop() ?? "repo").replace(/\.git$/, "")
			const depthFlag = depth === 0 ? "" : `--depth ${depth ?? 1}`
			const branchFlag = branch ? `--branch ${shellQuote(branch)}` : ""
			const result = await runCommand({
				sessionId,
				command: `git clone ${depthFlag} ${branchFlag} ${shellQuote(url)} ${shellQuote(target)}`,
				timeoutMs: 600_000,
				signal,
			})

			if (result.exitCode !== 0) {
				throw new Error(
					`Clone failed (exit ${result.exitCode}). ${result.stderr || result.stdout}`.trim(),
				)
			}

			const entries = await listWorkspace(sessionId, target).catch(() => [])
			return {
				path: target,
				url,
				branch,
				files: entries.length,
				top: entries
					.filter((entry) => !entry.path.slice(target.length + 1).includes("/"))
					.slice(0, 40)
					.map((entry) =>
						entry.type === "directory" ? `${entry.path}/` : entry.path,
					),
				durationMs: result.durationMs,
			}
		},
	}),

	web_search: tool({
		description:
			"Search the web for current information, documentation or library details.",
		inputSchema: z.object({
			query: z.string(),
			count: z.number().int().min(1).max(10).optional(),
		}),
		execute: async ({ query, count }) =>
			await webSearch(query, count ?? 6, signal),
	}),

	fetch_url: tool({
		description:
			"Fetch a web page or API response and return it as readable text. Use it to read a search result in full.",
		inputSchema: z.object({ url: z.string() }),
		execute: async ({ url }) => await fetchPage(url, signal),
	}),

	generate_image: tool({
		description:
			"Generate an image from a text prompt and save it into the workspace. Only available on paid ChatGPT plans.",
		inputSchema: z.object({
			prompt: z.string().describe("Detailed description of the image."),
			filename: z
				.string()
				.optional()
				.describe("Optional file name, saved under images/."),
			size: z.enum(["1024x1024", "1024x1536", "1536x1024", "auto"]).optional(),
		}),
		execute: async ({ prompt, filename, size }) => {
			const result = await generateImage({
				model: provider.image(IMAGE_MODEL),
				prompt,
				...(size && size !== "auto" ? { size } : {}),
			})
			const extension = result.image.mediaType.split("/")[1] ?? "png"
			const name = filename?.trim()
				? filename.replace(/^\/+/, "")
				: `images/${slugify(prompt)}-${Date.now()}.${extension}`
			const saved = await writeWorkspaceFile(
				sessionId,
				name,
				result.image.uint8Array,
			)
			return {
				path: saved.relative,
				mediaType: result.image.mediaType,
				bytes: saved.bytes,
				prompt,
			}
		},
	}),
})

export type AgentTools = ReturnType<typeof createAgentTools>
