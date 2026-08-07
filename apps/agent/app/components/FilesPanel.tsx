"use client"

import { useCallback, useEffect, useState } from "react"
import type { WorkspaceEntry } from "../lib/workspace"
import {
	CloseIcon,
	DownloadIcon,
	FileIcon,
	FolderIcon,
	RefreshIcon,
	SpinnerIcon,
} from "./icons"

const formatBytes = (bytes: number): string =>
	bytes < 1024
		? `${bytes} B`
		: bytes < 1024 * 1024
			? `${(bytes / 1024).toFixed(0)} KB`
			: `${(bytes / (1024 * 1024)).toFixed(1)} MB`

export function FilesPanel({
	sessionId,
	refreshToken,
	onClose,
}: {
	sessionId: string
	refreshToken: number
	onClose: () => void
}) {
	const [entries, setEntries] = useState<WorkspaceEntry[]>([])
	const [loading, setLoading] = useState(true)

	const load = useCallback(async () => {
		setLoading(true)
		try {
			const response = await fetch(
				`/api/workspace?sessionId=${encodeURIComponent(sessionId)}`,
				{ cache: "no-store" },
			)
			const payload = (await response.json()) as { entries?: WorkspaceEntry[] }
			setEntries(payload.entries ?? [])
		} catch {
			setEntries([])
		} finally {
			setLoading(false)
		}
	}, [sessionId])

	// biome-ignore lint/correctness/useExhaustiveDependencies: the token is the reload trigger
	useEffect(() => {
		void load()
	}, [load, refreshToken])

	const fileUrl = (path: string, download = false) =>
		`/api/workspace/file?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`

	return (
		<aside className="filesPanel">
			<div className="filesHeader">
				<FolderIcon className="icon sm" />
				<span style={{ flex: 1 }}>Workspace</span>
				<button
					aria-label="Refresh files"
					className="iconButton"
					onClick={() => void load()}
					type="button"
				>
					{loading ? (
						<SpinnerIcon className="icon sm spin" />
					) : (
						<RefreshIcon className="icon sm" />
					)}
				</button>
				<a
					aria-label="Download all files as a zip"
					className="iconButton"
					href={`/api/workspace/archive?sessionId=${encodeURIComponent(sessionId)}`}
					title="Download everything as .zip"
				>
					<DownloadIcon className="icon sm" />
				</a>
				<button
					aria-label="Close workspace panel"
					className="iconButton"
					onClick={onClose}
					type="button"
				>
					<CloseIcon className="icon sm" />
				</button>
			</div>

			{entries.some((entry) => entry.type === "file") ? (
				<a
					className="downloadAll"
					href={`/api/workspace/archive?sessionId=${encodeURIComponent(sessionId)}`}
				>
					<DownloadIcon className="icon sm" />
					Download all files (.zip)
				</a>
			) : null}

			<div className="filesList">
				{entries.length === 0 && !loading ? (
					<p className="filesEmpty">
						Nothing here yet. Files the agent creates in this chat's sandbox
						show up here, and you can open or download any of them.
					</p>
				) : null}

				{entries.map((entry) => {
					const depth = entry.path.split("/").length - 1
					const name = entry.path.split("/").pop() ?? entry.path
					if (entry.type === "directory") {
						return (
							<div
								className="fileRow"
								key={entry.path}
								style={{ paddingLeft: 8 + depth * 12 }}
							>
								<FolderIcon className="icon xs" />
								<span className="fileName">{name}</span>
							</div>
						)
					}
					return (
						<a
							className="fileRow"
							href={fileUrl(entry.path)}
							key={entry.path}
							rel="noreferrer noopener"
							style={{ paddingLeft: 8 + depth * 12 }}
							target="_blank"
						>
							<FileIcon className="icon xs" />
							<span className="fileName">{name}</span>
							<span className="fileSize">{formatBytes(entry.size)}</span>
							<DownloadIcon className="icon xs" />
						</a>
					)
				})}
			</div>
		</aside>
	)
}
