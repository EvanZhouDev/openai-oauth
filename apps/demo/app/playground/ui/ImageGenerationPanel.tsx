"use client"

import { useRef, useState } from "react"
import type {
	ImageBackground,
	ImageQuality,
	ImageSize,
} from "../lib/image-generation"
import type { ImageGenerationController } from "../lib/useImageGeneration"
import { ImageIcon, SendIcon, StopIcon, XIcon } from "./icons"

const sizes: ImageSize[] = ["auto", "1024x1024", "1024x1536", "1536x1024"]
const qualities: ImageQuality[] = ["auto", "low", "medium", "high"]
const backgrounds: ImageBackground[] = ["auto", "opaque", "transparent"]
const counts = [1, 2, 3, 4]

const suggestions = [
	{
		label: "Generate",
		prompt: "A tiny house in a misty forest, soft watercolor style.",
	},
	{
		label: "Generate",
		prompt: "A minimalist vector logo of a fox reading a book.",
	},
	{
		label: "Generate",
		prompt: "An isometric illustration of a cozy coffee shop at night.",
	},
]

export function ImageOptionsSidebar({
	controller,
	imageModels,
	isSignedIn,
}: {
	controller: ImageGenerationController
	imageModels: string[]
	isSignedIn: boolean
}) {
	const isEditMode = controller.references.length > 0

	return (
		<>
			<section className="controlGroup">
				<h2>Model</h2>
				<select
					disabled={!isSignedIn || imageModels.length === 0}
					onChange={(event) => controller.setModel(event.target.value)}
					value={controller.model}
				>
					{imageModels.length === 0 ? (
						<option value="">
							{isSignedIn ? "Loading models..." : "Sign in first"}
						</option>
					) : null}
					{imageModels.map((id) => (
						<option key={id} value={id}>
							{id}
						</option>
					))}
				</select>
				<p className="controlHint">
					{isEditMode ? (
						<>
							Attach a reference photo below to edit it via{" "}
							<code>/v1/images/edits</code>.
						</>
					) : (
						<>
							Describe an image below to create one via{" "}
							<code>/v1/images/generations</code>.
						</>
					)}
				</p>
			</section>

			<section className="controlGroup">
				<h2>Options</h2>
				<label className="fieldLabel" htmlFor="image-size">
					Size
				</label>
				<select
					id="image-size"
					onChange={(event) =>
						controller.setSize(event.target.value as ImageSize)
					}
					value={controller.size}
				>
					{sizes.map((size) => (
						<option key={size} value={size}>
							{size}
						</option>
					))}
				</select>
				<label className="fieldLabel" htmlFor="image-quality">
					Quality
				</label>
				<select
					id="image-quality"
					onChange={(event) =>
						controller.setQuality(event.target.value as ImageQuality)
					}
					value={controller.quality}
				>
					{qualities.map((quality) => (
						<option key={quality} value={quality}>
							{quality}
						</option>
					))}
				</select>
				<label className="fieldLabel" htmlFor="image-background">
					Background
				</label>
				<select
					id="image-background"
					onChange={(event) =>
						controller.setBackground(event.target.value as ImageBackground)
					}
					value={controller.background}
				>
					{backgrounds.map((background) => (
						<option key={background} value={background}>
							{background}
						</option>
					))}
				</select>
				<label className="fieldLabel" htmlFor="image-count">
					Images per request
				</label>
				<select
					id="image-count"
					onChange={(event) => controller.setCount(Number(event.target.value))}
					value={String(controller.count)}
				>
					{counts.map((count) => (
						<option key={count} value={count}>
							{count}
						</option>
					))}
				</select>
			</section>
		</>
	)
}

export function ImageGenerationMain({
	controller,
	isSignedIn,
	showInspector,
	onToggleInspector,
}: {
	controller: ImageGenerationController
	isSignedIn: boolean
	showInspector: boolean
	onToggleInspector: () => void
}) {
	const fileInputRef = useRef<HTMLInputElement>(null)
	const dragDepthRef = useRef(0)
	const [isDragging, setIsDragging] = useState(false)

	const canGenerate =
		isSignedIn &&
		!controller.isGenerating &&
		controller.prompt.trim().length > 0 &&
		!!controller.model

	return (
		<>
			<div className="conversationScroll">
				{controller.results.length === 0 ? (
					<div className="emptyState">
						<h1>Generate and edit images</h1>
						<p>
							Describe an image to create one, or attach a reference photo to
							edit it instead.
						</p>
						<div className="suggestions">
							{suggestions.map((suggestion) => (
								<button
									disabled={!isSignedIn || controller.isGenerating}
									key={suggestion.prompt}
									onClick={() => controller.setPrompt(suggestion.prompt)}
									type="button"
								>
									<strong>{suggestion.label}</strong>
									<span>{suggestion.prompt}</span>
								</button>
							))}
						</div>
					</div>
				) : (
					<div className="imageResults">
						{controller.results.map((entry) => (
							<article className="imageResult" key={entry.id}>
								<p className="imageResultPrompt">{entry.prompt}</p>
								{entry.referenceNames.length > 0 ? (
									<p className="imageResultMeta">
										Edited from {entry.referenceNames.join(", ")}
									</p>
								) : null}
								<div className="imageGallery">
									{entry.images.map((image, index) => (
										<a
											className="imageGalleryItem"
											download={`${entry.id}-${index + 1}.png`}
											href={image.dataUrl}
											key={image.id}
										>
											{/* biome-ignore lint/performance/noImgElement: data URLs, not files next/image can optimize */}
											<img alt={entry.prompt} src={image.dataUrl} />
										</a>
									))}
								</div>
								<p className="turnMeta">
									{entry.model} ·{" "}
									{entry.endpoint === "images/edits"
										? "/v1/images/edits"
										: "/v1/images/generations"}
									{entry.usage?.total != null
										? ` · ${entry.usage.total} tokens`
										: ""}
								</p>
							</article>
						))}
					</div>
				)}
			</div>

			{controller.error ? (
				<p className="errorBanner" role="alert">
					{controller.error}
				</p>
			) : null}

			<form
				className={`composer ${isDragging ? "composer--dragging" : ""}`}
				onDragEnter={(event) => {
					if (!event.dataTransfer.types.includes("Files")) {
						return
					}
					event.preventDefault()
					dragDepthRef.current += 1
					setIsDragging(true)
				}}
				onDragLeave={() => {
					dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
					if (dragDepthRef.current === 0) {
						setIsDragging(false)
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
					setIsDragging(false)
					if (isSignedIn && event.dataTransfer.files.length > 0) {
						void controller.addReferenceFiles(event.dataTransfer.files)
					}
				}}
				onSubmit={(event) => {
					event.preventDefault()
					void controller.generate()
				}}
			>
				{controller.references.length > 0 ? (
					<div className="attachmentsRow">
						{controller.references.map((image) => (
							<div className="attachmentThumb" key={image.id}>
								{/* biome-ignore lint/performance/noImgElement: data URLs, not files next/image can optimize */}
								<img alt={image.name} src={image.dataUrl} />
								<button
									aria-label={`Remove ${image.name}`}
									onClick={() => controller.removeReference(image.id)}
									type="button"
								>
									<XIcon />
								</button>
							</div>
						))}
					</div>
				) : null}

				{controller.referenceError ? (
					<p className="attachmentError" role="alert">
						{controller.referenceError}
					</p>
				) : null}

				<div className="composerRow">
					<input
						accept="image/*"
						hidden
						multiple
						onChange={(event) => {
							if (event.target.files) {
								void controller.addReferenceFiles(event.target.files)
							}
							event.target.value = ""
						}}
						ref={fileInputRef}
						type="file"
					/>
					<button
						aria-label="Attach a reference image"
						className="composerAttachButton"
						disabled={!isSignedIn}
						onClick={() => fileInputRef.current?.click()}
						type="button"
					>
						<ImageIcon />
					</button>
					<textarea
						disabled={!isSignedIn}
						onChange={(event) => controller.setPrompt(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault()
								void controller.generate()
							}
						}}
						placeholder={
							isSignedIn
								? controller.references.length > 0
									? "Describe the edit. Shift+Enter for a new line."
									: "Describe an image, or drop / paste a reference photo to edit it."
								: "Sign in with ChatGPT to start"
						}
						rows={1}
						value={controller.prompt}
					/>
					{controller.isGenerating ? (
						<button
							aria-label="Stop"
							className="composerButton composerButton--stop"
							onClick={controller.stop}
							type="button"
						>
							<StopIcon />
						</button>
					) : (
						<button
							aria-label="Generate"
							className="composerButton"
							disabled={!canGenerate}
							type="submit"
						>
							<SendIcon />
						</button>
					)}
				</div>
			</form>

			<div className="conversationFooter">
				<button
					disabled={controller.results.length === 0}
					onClick={controller.reset}
					type="button"
				>
					New session
				</button>
				<button onClick={onToggleInspector} type="button">
					{showInspector ? "Hide" : "Show"} inspector
				</button>
			</div>
		</>
	)
}
