"use client"

import { useState } from "react"
import type { PlanStep } from "../lib/types"
import {
	ChevronDownIcon,
	ChevronRightIcon,
	CircleCheckIcon,
	CircleDotIcon,
	CircleIcon,
	DownloadIcon,
	FileEditIcon,
	FileIcon,
	FilePlusIcon,
	FolderIcon,
	GlobeIcon,
	ImageIcon,
	ListIcon,
	SpinnerIcon,
	TerminalIcon,
	TrashIcon,
	WarningIcon,
} from "./icons"

export type ToolPart = {
	type: string
	toolCallId: string
	state:
		| "input-streaming"
		| "input-available"
		| "output-available"
		| "output-error"
	input?: unknown
	output?: unknown
	errorText?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const asString = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined

const asNumber = (value: unknown): number | undefined =>
	typeof value === "number" ? value : undefined

const TOOL_ICONS: Record<
	string,
	(props: { className?: string }) => React.ReactNode
> = {
	update_plan: ListIcon,
	list_files: FolderIcon,
	read_file: FileIcon,
	write_file: FilePlusIcon,
	edit_file: FileEditIcon,
	delete_path: TrashIcon,
	run_command: TerminalIcon,
	clone_repo: DownloadIcon,
	web_search: GlobeIcon,
	fetch_url: GlobeIcon,
	generate_image: ImageIcon,
}

const TOOL_LABELS: Record<string, { running: string; done: string }> = {
	update_plan: { running: "Planning", done: "Plan" },
	list_files: { running: "Listing files", done: "Listed files" },
	read_file: { running: "Reading", done: "Read" },
	write_file: { running: "Writing", done: "Created" },
	edit_file: { running: "Editing", done: "Edited" },
	delete_path: { running: "Deleting", done: "Deleted" },
	run_command: { running: "Running command", done: "Ran command" },
	clone_repo: { running: "Cloning", done: "Cloned" },
	web_search: { running: "Searching the web", done: "Searched the web" },
	fetch_url: { running: "Reading page", done: "Read page" },
	generate_image: { running: "Generating image", done: "Generated image" },
}

const toolSubject = (name: string, input: unknown): string | undefined => {
	if (!isRecord(input)) {
		return undefined
	}
	switch (name) {
		case "run_command":
			return asString(input.command)
		case "clone_repo":
			return asString(input.url)
		case "web_search":
			return asString(input.query)
		case "fetch_url":
			return asString(input.url)
		case "generate_image":
			return asString(input.prompt)
		default:
			return asString(input.path)
	}
}

const toolMeta = (name: string, output: unknown): string | undefined => {
	if (!isRecord(output)) {
		return undefined
	}
	switch (name) {
		case "run_command": {
			const code = asNumber(output.exitCode)
			const duration = asNumber(output.durationMs)
			const parts = [
				output.timedOut === true
					? "timed out"
					: code === 0
						? "exit 0"
						: `exit ${code ?? "?"}`,
			]
			if (duration !== undefined) {
				parts.push(`${(duration / 1000).toFixed(1)}s`)
			}
			return parts.join(" · ")
		}
		case "clone_repo": {
			const files = asNumber(output.files)
			return files === undefined ? undefined : `${files} files`
		}
		case "write_file": {
			const lines = asNumber(output.lines)
			return lines === undefined ? undefined : `${lines} lines`
		}
		case "edit_file": {
			const replacements = asNumber(output.replacements)
			return replacements === undefined
				? undefined
				: `${replacements} replacement${replacements === 1 ? "" : "s"}`
		}
		case "read_file": {
			const lines = asNumber(output.lines)
			return lines === undefined ? undefined : `${lines} lines`
		}
		case "list_files": {
			const count = asNumber(output.count)
			return count === undefined ? undefined : `${count} entries`
		}
		case "web_search": {
			const results = Array.isArray(output.results) ? output.results.length : 0
			return `${results} results`
		}
		default:
			return undefined
	}
}

function PlanCard({ steps, note }: { steps: PlanStep[]; note?: string }) {
	return (
		<div className="planCard">
			<div className="planHead">
				<ListIcon className="icon sm" />
				<span>Plan</span>
			</div>
			<ul className="planSteps">
				{steps.map((step, index) => (
					<li
						className={`planStep ${step.status}`}
						key={`${index}-${step.title}`}
					>
						<span className="stepIcon">
							{step.status === "completed" ? (
								<CircleCheckIcon className="icon sm" />
							) : step.status === "in_progress" ? (
								<CircleDotIcon className="icon sm" />
							) : (
								<CircleIcon className="icon sm" />
							)}
						</span>
						<span>{step.title}</span>
					</li>
				))}
			</ul>
			{note ? <p className="planNote">{note}</p> : null}
		</div>
	)
}

function CommandBody({ output }: { output: Record<string, unknown> }) {
	const stdout = asString(output.stdout) ?? ""
	const stderr = asString(output.stderr) ?? ""
	return (
		<>
			{stdout.trim().length > 0 ? (
				<div className="toolSection">
					<div className="toolSectionLabel">stdout</div>
					<pre>{stdout}</pre>
				</div>
			) : null}
			{stderr.trim().length > 0 ? (
				<div className="toolSection">
					<div className="toolSectionLabel">stderr</div>
					<pre>{stderr}</pre>
				</div>
			) : null}
			{stdout.trim().length === 0 && stderr.trim().length === 0 ? (
				<div className="toolSection">
					<div className="toolSectionLabel">output</div>
					<pre>(no output)</pre>
				</div>
			) : null}
		</>
	)
}

function SearchBody({ output }: { output: Record<string, unknown> }) {
	const results = Array.isArray(output.results) ? output.results : []
	return (
		<div className="toolSection">
			{results.filter(isRecord).map((result, index) => (
				<div
					key={`${asString(result.url) ?? index}`}
					style={{ marginBottom: 10 }}
				>
					<a
						href={asString(result.url)}
						rel="noreferrer noopener"
						style={{ color: "var(--info)" }}
						target="_blank"
					>
						{asString(result.title) ?? asString(result.url)}
					</a>
					<div style={{ color: "var(--text-tertiary)", fontSize: 12.5 }}>
						{asString(result.snippet)?.slice(0, 220)}
					</div>
				</div>
			))}
		</div>
	)
}

export function ToolCall({
	part,
	sessionId,
}: {
	part: ToolPart
	sessionId: string
}) {
	const name = part.type.replace(/^tool-/, "")
	const [open, setOpen] = useState(false)

	const running =
		part.state === "input-streaming" || part.state === "input-available"
	const failed = part.state === "output-error"
	const Icon = TOOL_ICONS[name] ?? FileIcon
	const labels = TOOL_LABELS[name] ?? { running: name, done: name }
	const subject = toolSubject(name, part.input)
	const meta = failed ? "failed" : toolMeta(name, part.output)

	// The plan gets its own presentation — it is the agent thinking out loud.
	if (name === "update_plan") {
		const source = isRecord(part.output)
			? part.output
			: isRecord(part.input)
				? part.input
				: undefined
		const steps = Array.isArray(source?.steps)
			? (source.steps.filter(isRecord) as unknown as PlanStep[])
			: []
		if (steps.length > 0) {
			return <PlanCard note={asString(source?.note)} steps={steps} />
		}
	}

	const output = isRecord(part.output) ? part.output : undefined
	const imagePath =
		name === "generate_image" ? asString(output?.path) : undefined

	return (
		<div className="toolCard">
			<button
				className="toolHeader"
				onClick={() => setOpen((value) => !value)}
				type="button"
			>
				<span
					className={`toolIcon ${running ? "running" : ""} ${failed ? "error" : ""}`}
				>
					{running ? (
						<SpinnerIcon className="icon sm spin" />
					) : failed ? (
						<WarningIcon className="icon sm" />
					) : (
						<Icon className="icon sm" />
					)}
				</span>
				<span className="toolTitle">
					<span className={running ? "shimmer" : undefined}>
						{running ? labels.running : labels.done}
					</span>
					{subject ? <code>{subject}</code> : null}
				</span>
				{meta ? <span className="toolMeta">{meta}</span> : null}
				{open ? (
					<ChevronDownIcon className="icon sm" />
				) : (
					<ChevronRightIcon className="icon sm" />
				)}
			</button>

			{open ? (
				<div className="toolBody">
					{failed ? (
						<div className="toolSection">
							<div className="toolSectionLabel">error</div>
							<pre>{part.errorText ?? "The tool call failed."}</pre>
						</div>
					) : null}

					{name === "run_command" && output ? (
						<CommandBody output={output} />
					) : name === "web_search" && output ? (
						<SearchBody output={output} />
					) : imagePath ? (
						// biome-ignore lint/performance/noImgElement: workspace files are served raw
						<img
							alt={
								asString(
									part.input && isRecord(part.input) ? part.input.prompt : "",
								) ?? "Generated image"
							}
							src={`/api/workspace/file?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(imagePath)}`}
							style={{ maxWidth: "100%", borderRadius: 10 }}
						/>
					) : (
						<>
							{part.input !== undefined ? (
								<div className="toolSection">
									<div className="toolSectionLabel">input</div>
									<pre>
										{JSON.stringify(part.input, null, 2).slice(0, 4000)}
									</pre>
								</div>
							) : null}
							{part.output !== undefined ? (
								<div className="toolSection">
									<div className="toolSectionLabel">result</div>
									<pre>
										{typeof part.output === "string"
											? part.output.slice(0, 4000)
											: JSON.stringify(part.output, null, 2).slice(0, 4000)}
									</pre>
								</div>
							) : null}
						</>
					)}
				</div>
			) : null}
		</div>
	)
}
