"use client"

import {
	openaiAuthHeaders,
	SignInWithChatGPT,
	type SignInWithChatGPTState,
} from "@openai-oauth/react"
import Image from "next/image"
import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import {
	type ImageAttachment,
	MAX_ATTACHMENTS,
	readImageFiles,
} from "../lib/images"
import { endpointLabel, endpointPath, runConversation } from "../lib/run"
import { playgroundTools } from "../lib/tools"
import type {
	EndpointId,
	HistoryItem,
	InspectorEntry,
	ReasoningEffort,
	RunEvent,
} from "../lib/types"
import { useImageGeneration } from "../lib/useImageGeneration"
import {
	ImageGenerationMain,
	ImageOptionsSidebar,
} from "./ImageGenerationPanel"
import { Inspector } from "./Inspector"
import {
	CheckIcon,
	GitHubIcon,
	ImageIcon,
	SendIcon,
	StopIcon,
	XIcon,
} from "./icons"
import { Transcript } from "./Transcript"

const MAX_INSPECTOR_ENTRIES = 400

const reasoningEfforts: ReasoningEffort[] = ["minimal", "low", "medium", "high"]

type Mode = "chat" | "image"

type CoverageId =
	| "models"
	| "responses"
	| "chat"
	| "streaming"
	| "non-streaming"
	| "tools"
	| "reasoning"
	| "vision"
	| "images-generate"
	| "images-edit"

const coverageChecks: Array<{ id: CoverageId; label: string }> = [
	{ id: "models", label: "GET /v1/models" },
	{ id: "responses", label: "POST /v1/responses" },
	{ id: "chat", label: "POST /v1/chat/completions" },
	{ id: "streaming", label: "Streaming responses" },
	{ id: "non-streaming", label: "Non-streaming responses" },
	{ id: "tools", label: "Tool calls" },
	{ id: "reasoning", label: "Reasoning traces" },
	{ id: "vision", label: "Image input" },
	{ id: "images-generate", label: "POST /v1/images/generations" },
	{ id: "images-edit", label: "POST /v1/images/edits" },
]

const suggestions = [
	{
		label: "Tool call",
		prompt:
			"What is the weather in Reykjavik, and what is (19 * 4) / 7? Use your tools.",
	},
	{
		label: "Multi-step tools",
		prompt:
			"Compare the temperature in Oslo and Cairo, then tell me the difference. Use your tools for both lookups and the subtraction.",
	},
	{
		label: "Reasoning",
		prompt:
			"A bat and a ball cost $1.10 together. The bat costs $1.00 more than the ball. How much is the ball? Think it through.",
	},
	{ label: "Streaming", prompt: "Write a short poem about OAuth tokens." },
]

const newId = (prefix: string) =>
	`${prefix}_${globalThis.crypto.randomUUID().slice(0, 8)}`

const isDeltaEvent = (label: string): boolean =>
	label.endsWith(".delta") || label === "chat.completion.chunk"

/** Applies one streamed event to the visible transcript. */
const applyEvent = (items: HistoryItem[], event: RunEvent): HistoryItem[] => {
	switch (event.type) {
		case "assistant-start":
			return [
				...items,
				{
					kind: "assistant",
					id: event.id,
					text: "",
					reasoning: "",
					toolCalls: [],
				},
			]

		case "text-delta":
		case "reasoning-delta":
		case "tool-call-start":
		case "tool-args-delta":
		case "tool-call-end":
		case "turn-meta": {
			let index = items.length - 1
			while (index >= 0 && items[index]?.kind !== "assistant") {
				index -= 1
			}
			const target = items[index]
			if (index < 0 || target?.kind !== "assistant") {
				return items
			}

			const next = [...items]
			if (event.type === "text-delta") {
				next[index] = { ...target, text: target.text + event.delta }
			} else if (event.type === "reasoning-delta") {
				next[index] = { ...target, reasoning: target.reasoning + event.delta }
			} else if (event.type === "turn-meta") {
				next[index] = { ...target, meta: event.meta }
			} else if (event.type === "tool-call-start") {
				next[index] = {
					...target,
					toolCalls: [
						...target.toolCalls,
						{
							callId: event.callId,
							name: event.name,
							arguments: "",
							status: "streaming",
						},
					],
				}
			} else {
				next[index] = {
					...target,
					toolCalls: target.toolCalls.map((call) =>
						call.callId !== event.callId
							? call
							: event.type === "tool-args-delta"
								? { ...call, arguments: call.arguments + event.delta }
								: { ...call, arguments: event.args, status: "running" },
					),
				}
			}
			return next
		}

		case "tool-result":
			return items.map((item) =>
				item.kind !== "assistant"
					? item
					: {
							...item,
							toolCalls: item.toolCalls.map((call) =>
								call.callId !== event.callId
									? call
									: {
											...call,
											result: event.output,
											error: event.error,
											status: event.error ? "error" : "done",
										},
							),
						},
			)

		case "history":
			// The runner's copy carries `responsesItems`, which the next request
			// needs; the visible copy carries `meta`, which it does not.
			return event.items.map((item) => {
				if (item.kind !== "assistant") {
					return item
				}
				const existing = items.find(
					(candidate) =>
						candidate.id === item.id && candidate.kind === "assistant",
				)
				return existing?.kind === "assistant" && existing.meta
					? { ...item, meta: existing.meta }
					: item
			})

		default:
			return items
	}
}

export function Playground() {
	const [authState, setAuthState] = useState<SignInWithChatGPTState>({
		status: "checking",
		session: null,
		error: null,
	})
	const [mode, setMode] = useState<Mode>("chat")
	const [models, setModels] = useState<string[]>([])
	const [imageModels, setImageModels] = useState<string[]>([])
	const [modelsError, setModelsError] = useState<string | null>(null)
	const [model, setModel] = useState("")
	const [endpoint, setEndpoint] = useState<EndpointId>("responses")
	const [stream, setStream] = useState(true)
	const [toolsEnabled, setToolsEnabled] = useState(true)
	const [reasoningEffort, setReasoningEffort] =
		useState<ReasoningEffort>("medium")
	const [instructions, setInstructions] = useState(
		"You are a concise assistant running inside the OpenAI OAuth playground.",
	)
	const [items, setItems] = useState<HistoryItem[]>([])
	const [input, setInput] = useState("")
	const [attachments, setAttachments] = useState<ImageAttachment[]>([])
	const [attachmentError, setAttachmentError] = useState<string | null>(null)
	const [isDraggingImage, setIsDraggingImage] = useState(false)
	const [isRunning, setIsRunning] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [entries, setEntries] = useState<InspectorEntry[]>([])
	const [hideDeltas, setHideDeltas] = useState(true)
	const [covered, setCovered] = useState<Set<CoverageId>>(new Set())
	const [showInspector, setShowInspector] = useState(true)

	const abortRef = useRef<AbortController | null>(null)
	const transcriptRef = useRef<HTMLDivElement>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)
	const dragDepthRef = useRef(0)
	const isSignedIn = authState.status === "signed-in"

	const markCovered = useCallback((id: CoverageId) => {
		setCovered((current) =>
			current.has(id) ? current : new Set(current).add(id),
		)
	}, [])

	const addEntry = useCallback((entry: Omit<InspectorEntry, "id" | "at">) => {
		setEntries((current) => [
			...current.slice(-(MAX_INSPECTOR_ENTRIES - 1)),
			{ ...entry, id: newId("entry"), at: Date.now() },
		])
	}, [])

	const addFiles = useCallback(async (files: FileList | File[]) => {
		const list = Array.from(files)
		if (list.length === 0) {
			return
		}

		setAttachmentError(null)
		const { attachments: decoded, errors } = await readImageFiles(list)

		setAttachments((current) => {
			const merged = [...current, ...decoded]
			const overflow = merged.length - MAX_ATTACHMENTS
			if (overflow > 0) {
				errors.push(
					`Only ${MAX_ATTACHMENTS} images per message; dropped the last ${overflow}.`,
				)
			}
			return merged.slice(0, MAX_ATTACHMENTS)
		})

		if (errors.length > 0) {
			setAttachmentError(errors.join(" "))
		}
	}, [])

	const removeAttachment = useCallback((id: string) => {
		setAttachments((current) => current.filter((image) => image.id !== id))
	}, [])

	const imageGen = useImageGeneration({
		imageModels,
		onCoverage: markCovered,
		onEntry: addEntry,
	})

	useEffect(() => {
		if (!isSignedIn) {
			setModels([])
			setImageModels([])
			setModelsError(null)
			return
		}

		let cancelled = false
		void (async () => {
			try {
				const response = await fetch("/api/v1/models", {
					headers: await openaiAuthHeaders(),
				})
				const payload: unknown = await response.json()
				if (cancelled) {
					return
				}

				if (!response.ok) {
					const message =
						typeof payload === "object" &&
						payload !== null &&
						"error" in payload &&
						typeof (payload as { error?: { message?: string } }).error
							?.message === "string"
							? (payload as { error: { message: string } }).error.message
							: `Failed to load models (HTTP ${response.status}).`
					throw new Error(message)
				}

				const data = (payload as { data?: Array<{ id?: string }> }).data ?? []
				const ids = data
					.map((entry) => entry.id)
					.filter((id): id is string => typeof id === "string")
				const chatIds = ids.filter((id) => !id.includes("image"))
				const generationIds = ids.filter((id) => id.includes("image"))

				setModels(chatIds)
				setImageModels(generationIds)
				setModel((current) =>
					current && chatIds.includes(current) ? current : (chatIds[0] ?? ""),
				)
				setModelsError(null)
				markCovered("models")
				addEntry({
					kind: "response",
					label: "GET /v1/models",
					payload,
				})
			} catch (loadError) {
				if (cancelled) {
					return
				}
				setModelsError(
					loadError instanceof Error
						? loadError.message
						: "Failed to load models.",
				)
			}
		})()

		return () => {
			cancelled = true
		}
	}, [isSignedIn, addEntry, markCovered])

	const handleAuthStateChange = (next: SignInWithChatGPTState) => {
		setAuthState(next)
		if (next.status !== "signed-in") {
			setItems([])
			setEntries([])
			setCovered(new Set())
			setError(null)
			setAttachments([])
			setAttachmentError(null)
			imageGen.reset()
		}
	}

	const send = async (prompt: string, images: ImageAttachment[] = []) => {
		const text = prompt.trim()
		if ((!text && images.length === 0) || isRunning || !isSignedIn || !model) {
			return
		}

		setError(null)
		setInput("")
		setAttachments([])
		setAttachmentError(null)

		const base: HistoryItem[] = [
			...items,
			{
				kind: "user",
				id: newId("user"),
				text,
				images: images.length > 0 ? images : undefined,
			},
		]
		setItems(base)

		const controller = new AbortController()
		abortRef.current = controller
		setIsRunning(true)

		markCovered(endpoint === "responses" ? "responses" : "chat")
		markCovered(stream ? "streaming" : "non-streaming")
		if (images.length > 0) {
			markCovered("vision")
		}

		let working = base
		try {
			for await (const event of runConversation({
				endpoint,
				model,
				stream,
				reasoningEffort,
				toolsEnabled,
				instructions,
				history: base,
				signal: controller.signal,
			})) {
				switch (event.type) {
					case "request":
						addEntry({
							kind: "request",
							label: `POST ${endpointLabel[event.endpoint]}`,
							payload: event.body,
						})
						break
					case "response":
						addEntry({
							kind: "response",
							label: event.label,
							payload: event.payload,
						})
						break
					case "stream-event":
						if (!hideDeltas || !isDeltaEvent(event.label)) {
							addEntry({
								kind: "stream",
								label: event.label,
								payload: event.payload,
							})
						}
						break
					case "tool-call-end":
						markCovered("tools")
						break
					case "reasoning-delta":
						markCovered("reasoning")
						break
					case "tool-result":
						addEntry({
							kind: "tool",
							label: `${event.name} → ${event.error ? "error" : "ok"}`,
							payload: { call_id: event.callId, output: event.output },
						})
						break
					case "error":
						setError(event.message)
						addEntry({ kind: "error", label: "error", payload: event.message })
						break
				}

				working = applyEvent(working, event)
				setItems(working)

				transcriptRef.current?.scrollTo({
					top: transcriptRef.current.scrollHeight,
				})
			}
		} finally {
			abortRef.current = null
			setIsRunning(false)
		}
	}

	const stop = () => {
		abortRef.current?.abort()
	}

	const reset = () => {
		abortRef.current?.abort()
		setItems([])
		setError(null)
		setAttachments([])
		setAttachmentError(null)
	}

	const canSend =
		isSignedIn &&
		!isRunning &&
		(input.trim().length > 0 || attachments.length > 0) &&
		!!model

	return (
		<main className="playgroundShell">
			<header className="playgroundHeader">
				<Link aria-label="OpenAI OAuth" className="wordmark" href="/">
					<Image
						alt=""
						height={26}
						priority
						src="/openai-oauth-wordmark.svg"
						width={188}
					/>
				</Link>
				<div className="playgroundTitleGroup">
					<span className="playgroundTitle">Playground</span>
					<fieldset className="headerModeToggle">
						<button
							aria-pressed={mode === "chat"}
							onClick={() => setMode("chat")}
							type="button"
						>
							Chat
						</button>
						<button
							aria-pressed={mode === "image"}
							onClick={() => setMode("image")}
							type="button"
						>
							Image generation
						</button>
					</fieldset>
				</div>
				<a
					aria-label="GitHub"
					className="githubLink"
					href="https://github.com/EvanZhouDev/openai-oauth"
					rel="noreferrer"
					target="_blank"
				>
					<GitHubIcon />
				</a>
			</header>

			<div className="playgroundGrid">
				<aside className="controls">
					<section className="controlGroup">
						<h2>Account</h2>
						<SignInWithChatGPT
							hideAttribution
							onStateChange={handleAuthStateChange}
							style={{ width: "100%" }}
						/>
						{isSignedIn ? (
							<p className="controlHint">
								Requests are signed with your ChatGPT session and proxied
								through <code>/api/v1/*</code> on this site.
							</p>
						) : (
							<p className="controlHint">
								Sign in to load your account&apos;s models and start a
								conversation.
							</p>
						)}
						{authState.status === "error" ? (
							<p className="errorText" role="alert">
								{authState.error.message}
							</p>
						) : null}
					</section>

					{mode === "chat" ? (
						<>
							<section className="controlGroup">
								<h2>Model</h2>
								<select
									disabled={!isSignedIn || models.length === 0}
									onChange={(event) => setModel(event.target.value)}
									value={model}
								>
									{models.length === 0 ? (
										<option value="">
											{isSignedIn ? "Loading models..." : "Sign in first"}
										</option>
									) : null}
									{models.map((id) => (
										<option key={id} value={id}>
											{id}
										</option>
									))}
								</select>
								<p className="controlHint">
									From <code>GET /v1/models</code>, scoped to your ChatGPT plan.
								</p>
								{modelsError ? (
									<p className="errorText" role="alert">
										{modelsError}
									</p>
								) : null}
							</section>

							<section className="controlGroup">
								<h2>Endpoint</h2>
								<fieldset className="segmented">
									{(["responses", "chat-completions"] as EndpointId[]).map(
										(id) => (
											<button
												aria-pressed={endpoint === id}
												key={id}
												onClick={() => setEndpoint(id)}
												type="button"
											>
												{endpointLabel[id]}
											</button>
										),
									)}
								</fieldset>
								<p className="controlHint">
									Posts to <code>{endpointPath[endpoint]}</code>. Both are
									stateless, so the full conversation is resent every turn.
								</p>
							</section>

							<section className="controlGroup">
								<h2>Options</h2>
								<label className="checkbox">
									<input
										checked={stream}
										onChange={(event) => setStream(event.target.checked)}
										type="checkbox"
									/>
									<span>Stream the response</span>
								</label>
								<label className="checkbox">
									<input
										checked={toolsEnabled}
										onChange={(event) => setToolsEnabled(event.target.checked)}
										type="checkbox"
									/>
									<span>Send tool definitions</span>
								</label>
								<label className="fieldLabel" htmlFor="reasoning-effort">
									Reasoning effort
								</label>
								<select
									id="reasoning-effort"
									onChange={(event) =>
										setReasoningEffort(event.target.value as ReasoningEffort)
									}
									value={reasoningEffort}
								>
									{reasoningEfforts.map((effort) => (
										<option key={effort} value={effort}>
											{effort}
										</option>
									))}
								</select>
								<label className="fieldLabel" htmlFor="instructions">
									System instructions
								</label>
								<textarea
									id="instructions"
									onChange={(event) => setInstructions(event.target.value)}
									rows={3}
									value={instructions}
								/>
							</section>

							<section className="controlGroup">
								<h2>Tools</h2>
								<ul className="toolList">
									{playgroundTools.map((entry) => (
										<li key={entry.name}>
											<code>{entry.name}</code>
											<span>{entry.description}</span>
										</li>
									))}
								</ul>
								<p className="controlHint">
									Executed in your browser, then sent back as tool results for
									the next round.
								</p>
							</section>
						</>
					) : (
						<ImageOptionsSidebar
							controller={imageGen}
							imageModels={imageModels}
							isSignedIn={isSignedIn}
						/>
					)}

					<section className="controlGroup">
						<h2>Coverage</h2>
						<ul className="coverageList">
							{coverageChecks.map((check) => (
								<li
									className={covered.has(check.id) ? "isCovered" : ""}
									key={check.id}
								>
									<span className="coverageMark">
										{covered.has(check.id) ? <CheckIcon /> : null}
									</span>
									{check.label}
								</li>
							))}
						</ul>
					</section>
				</aside>

				<section className="conversation">
					{mode === "chat" ? (
						<>
							<div className="conversationScroll" ref={transcriptRef}>
								{items.length === 0 ? (
									<div className="emptyState">
										<h1>Test every endpoint end to end</h1>
										<p>
											Sign in with your ChatGPT account, pick an endpoint, and
											watch the raw stream in the inspector.
										</p>
										<div className="suggestions">
											{suggestions.map((suggestion) => (
												<button
													disabled={!isSignedIn || isRunning}
													key={suggestion.label}
													onClick={() => void send(suggestion.prompt)}
													type="button"
												>
													<strong>{suggestion.label}</strong>
													<span>{suggestion.prompt}</span>
												</button>
											))}
										</div>
									</div>
								) : (
									<Transcript isRunning={isRunning} items={items} />
								)}
							</div>

							{error ? (
								<p className="errorBanner" role="alert">
									{error}
								</p>
							) : null}

							<form
								className={`composer ${isDraggingImage ? "composer--dragging" : ""}`}
								onDragEnter={(event) => {
									if (!event.dataTransfer.types.includes("Files")) {
										return
									}
									event.preventDefault()
									dragDepthRef.current += 1
									setIsDraggingImage(true)
								}}
								onDragLeave={() => {
									dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
									if (dragDepthRef.current === 0) {
										setIsDraggingImage(false)
									}
								}}
								onDragOver={(event) => {
									if (event.dataTransfer.types.includes("Files")) {
										event.preventDefault()
									}
								}}
								onDrop={(event) => {
									event.preventDefault()
									dragDepthRef.current = 0
									setIsDraggingImage(false)
									if (isSignedIn && event.dataTransfer.files.length > 0) {
										void addFiles(event.dataTransfer.files)
									}
								}}
								onSubmit={(event) => {
									event.preventDefault()
									void send(input, attachments)
								}}
							>
								{attachments.length > 0 ? (
									<div className="attachmentsRow">
										{attachments.map((image) => (
											<div className="attachmentThumb" key={image.id}>
												{/* biome-ignore lint/performance/noImgElement: data URLs, not files next/image can optimize */}
												<img alt={image.name} src={image.dataUrl} />
												<button
													aria-label={`Remove ${image.name}`}
													onClick={() => removeAttachment(image.id)}
													type="button"
												>
													<XIcon />
												</button>
											</div>
										))}
									</div>
								) : null}

								{attachmentError ? (
									<p className="attachmentError" role="alert">
										{attachmentError}
									</p>
								) : null}

								<div className="composerRow">
									<input
										accept="image/*"
										hidden
										multiple
										onChange={(event) => {
											if (event.target.files) {
												void addFiles(event.target.files)
											}
											event.target.value = ""
										}}
										ref={fileInputRef}
										type="file"
									/>
									<button
										aria-label="Attach images"
										className="composerAttachButton"
										disabled={
											!isSignedIn || attachments.length >= MAX_ATTACHMENTS
										}
										onClick={() => fileInputRef.current?.click()}
										type="button"
									>
										<ImageIcon />
									</button>
									<textarea
										disabled={!isSignedIn}
										onChange={(event) => setInput(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter" && !event.shiftKey) {
												event.preventDefault()
												void send(input, attachments)
											}
										}}
										onPaste={(event) => {
											const files = Array.from(
												event.clipboardData.files,
											).filter((file) => file.type.startsWith("image/"))
											if (files.length > 0) {
												event.preventDefault()
												void addFiles(files)
											}
										}}
										placeholder={
											isSignedIn
												? "Ask anything, or drop / paste an image. Shift+Enter for a new line."
												: "Sign in with ChatGPT to start"
										}
										rows={1}
										value={input}
									/>
									{isRunning ? (
										<button
											aria-label="Stop"
											className="composerButton composerButton--stop"
											onClick={stop}
											type="button"
										>
											<StopIcon />
										</button>
									) : (
										<button
											aria-label="Send"
											className="composerButton"
											disabled={!canSend}
											type="submit"
										>
											<SendIcon />
										</button>
									)}
								</div>
							</form>

							<div className="conversationFooter">
								<button
									disabled={items.length === 0}
									onClick={reset}
									type="button"
								>
									New conversation
								</button>
								<button
									onClick={() => setShowInspector((open) => !open)}
									type="button"
								>
									{showInspector ? "Hide" : "Show"} inspector
								</button>
							</div>
						</>
					) : (
						<ImageGenerationMain
							controller={imageGen}
							isSignedIn={isSignedIn}
							onToggleInspector={() => setShowInspector((open) => !open)}
							showInspector={showInspector}
						/>
					)}
				</section>

				{showInspector ? (
					<Inspector
						entries={entries}
						hideDeltas={hideDeltas}
						onClear={() => setEntries([])}
						onHideDeltasChange={setHideDeltas}
					/>
				) : null}
			</div>
		</main>
	)
}
