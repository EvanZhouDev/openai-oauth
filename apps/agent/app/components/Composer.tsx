"use client"

import {
	type ChangeEvent,
	type ClipboardEvent,
	type DragEvent,
	type KeyboardEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react"
import type { Attachment } from "../lib/types"
import {
	CloseIcon,
	FileIcon,
	ImageIcon,
	PaperclipIcon,
	SendIcon,
	SpinnerIcon,
	StopIcon,
} from "./icons"

const readDataUrl = (file: File): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(String(reader.result))
		reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
		reader.readAsDataURL(file)
	})

const formatBytes = (bytes: number): string =>
	bytes < 1024
		? `${bytes} B`
		: bytes < 1024 * 1024
			? `${(bytes / 1024).toFixed(0)} KB`
			: `${(bytes / (1024 * 1024)).toFixed(1)} MB`

export type ComposerProps = {
	sessionId: string
	busy: boolean
	imageMode: boolean
	onToggleImageMode: () => void
	onSend: (text: string, attachments: Attachment[]) => void
	onStop: () => void
	placeholder?: string
}

export function Composer({
	sessionId,
	busy,
	imageMode,
	onToggleImageMode,
	onSend,
	onStop,
	placeholder,
}: ComposerProps) {
	const [text, setText] = useState("")
	const [attachments, setAttachments] = useState<Attachment[]>([])
	const [dragging, setDragging] = useState(false)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)

	const resize = useCallback(() => {
		const element = textareaRef.current
		if (!element) {
			return
		}
		element.style.height = "auto"
		element.style.height = `${Math.min(element.scrollHeight, window.innerHeight * 0.45)}px`
	}, [])

	// biome-ignore lint/correctness/useExhaustiveDependencies: sizes the textarea on mount
	useEffect(resize, [resize])

	const uploadFiles = useCallback(
		async (files: File[]) => {
			for (const file of files) {
				const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
				const isImage = file.type.startsWith("image/")
				setAttachments((current) => [
					...current,
					{
						id,
						name: file.name,
						path: "",
						mediaType: file.type || "application/octet-stream",
						bytes: file.size,
						isImage,
						isText: false,
						status: "uploading",
					},
				])

				try {
					const form = new FormData()
					form.append("sessionId", sessionId)
					form.append("file", file)
					const response = await fetch("/api/upload", {
						method: "POST",
						body: form,
					})
					const raw = await response.text()
					const payload = (raw.trim().length > 0 ? JSON.parse(raw) : {}) as {
						path?: string
						mediaType?: string
						bytes?: number
						isImage?: boolean
						isText?: boolean
						error?: string
					}
					if (!response.ok || !payload.path) {
						throw new Error(payload.error ?? "Upload failed.")
					}

					const dataUrl = isImage ? await readDataUrl(file) : undefined
					setAttachments((current) =>
						current.map((item) =>
							item.id === id
								? {
										...item,
										path: payload.path as string,
										mediaType: payload.mediaType ?? item.mediaType,
										bytes: payload.bytes ?? item.bytes,
										isImage: payload.isImage ?? isImage,
										isText: payload.isText ?? false,
										dataUrl,
										status: "ready",
									}
								: item,
						),
					)
				} catch (error) {
					setAttachments((current) =>
						current.map((item) =>
							item.id === id
								? {
										...item,
										status: "error",
										error:
											error instanceof Error ? error.message : String(error),
									}
								: item,
						),
					)
				}
			}
		},
		[sessionId],
	)

	const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.target.files ?? [])
		if (files.length > 0) {
			void uploadFiles(files)
		}
		event.target.value = ""
	}

	const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		const files = Array.from(event.clipboardData?.files ?? [])
		if (files.length > 0) {
			event.preventDefault()
			void uploadFiles(files)
		}
	}

	const handleDrop = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault()
		setDragging(false)
		const files = Array.from(event.dataTransfer?.files ?? [])
		if (files.length > 0) {
			void uploadFiles(files)
		}
	}

	const uploading = attachments.some((item) => item.status === "uploading")
	const canSend = !busy && !uploading && text.trim().length > 0

	const submit = () => {
		if (!canSend) {
			return
		}
		onSend(
			text.trim(),
			attachments.filter((item) => item.status === "ready"),
		)
		setText("")
		setAttachments([])
		window.requestAnimationFrame(resize)
	}

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (
			event.key === "Enter" &&
			!event.shiftKey &&
			!event.nativeEvent.isComposing
		) {
			const isTouch = window.matchMedia("(pointer: coarse)").matches
			if (!isTouch) {
				event.preventDefault()
				submit()
			}
		}
	}

	return (
		<div className="composerWrap">
			<div className="composerInner">
				{/* biome-ignore lint/a11y/noStaticElementInteractions: drop target wraps the form */}
				<div
					className={`composer ${dragging ? "dragging" : ""}`}
					onDragLeave={() => setDragging(false)}
					onDragOver={(event) => {
						event.preventDefault()
						setDragging(true)
					}}
					onDrop={handleDrop}
				>
					{attachments.length > 0 ? (
						<div className="composerAttachments">
							{attachments.map((attachment) => (
								<div className="composerChip" key={attachment.id}>
									{attachment.status === "uploading" ? (
										<SpinnerIcon className="icon sm spin" />
									) : attachment.isImage && attachment.dataUrl ? (
										// biome-ignore lint/performance/noImgElement: local preview of a pasted file
										<img
											alt=""
											src={attachment.dataUrl}
											style={{
												width: 26,
												height: 26,
												borderRadius: 6,
												objectFit: "cover",
											}}
										/>
									) : (
										<FileIcon className="icon sm" />
									)}
									<span className="chipText">
										{attachment.name}
										{attachment.status === "error" ? (
											<span style={{ color: "var(--danger)" }}>
												{" "}
												— {attachment.error}
											</span>
										) : (
											<span style={{ color: "var(--text-tertiary)" }}>
												{" "}
												{formatBytes(attachment.bytes)}
											</span>
										)}
									</span>
									<button
										aria-label={`Remove ${attachment.name}`}
										className="chipRemove"
										onClick={() =>
											setAttachments((current) =>
												current.filter((item) => item.id !== attachment.id),
											)
										}
										type="button"
									>
										<CloseIcon className="icon xs" />
									</button>
								</div>
							))}
						</div>
					) : null}

					<label className="srOnly" htmlFor="composer-input">
						Message the agent
					</label>
					<textarea
						className="composerTextarea"
						id="composer-input"
						onChange={(event) => {
							setText(event.target.value)
							resize()
						}}
						onKeyDown={handleKeyDown}
						onPaste={handlePaste}
						placeholder={
							placeholder ??
							(imageMode
								? "Describe an image to generate"
								: "Ask anything, or describe a task to build")
						}
						ref={textareaRef}
						rows={1}
						value={text}
					/>

					<div className="composerRow">
						<button
							aria-label="Attach files"
							className="composerButton"
							onClick={() => fileInputRef.current?.click()}
							title="Attach files or images"
							type="button"
						>
							<PaperclipIcon className="icon sm" />
						</button>
						<button
							aria-pressed={imageMode}
							className={`composerButton ${imageMode ? "active" : ""}`}
							onClick={onToggleImageMode}
							title="Create an image"
							type="button"
						>
							<ImageIcon className="icon sm" />
							<span style={{ fontSize: 13 }}>Image</span>
						</button>

						<span className="grow" />

						{busy ? (
							<button
								aria-label="Stop generating"
								className="sendButton"
								onClick={onStop}
								type="button"
							>
								<StopIcon className="icon sm" />
							</button>
						) : (
							<button
								aria-label="Send message"
								className="sendButton"
								disabled={!canSend}
								onClick={submit}
								type="button"
							>
								<SendIcon className="icon sm" />
							</button>
						)}
					</div>

					<input
						accept="*/*"
						className="srOnly"
						multiple
						onChange={handleFileInput}
						ref={fileInputRef}
						type="file"
					/>
				</div>

				<p className="composerHint">
					The agent runs commands and writes files in its own sandbox. Check
					anything important before you rely on it.
				</p>
			</div>
		</div>
	)
}
