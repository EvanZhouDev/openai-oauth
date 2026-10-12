import { useCallback, useEffect, useRef, useState } from "react"
import {
	type GeneratedImage,
	type ImageBackground,
	type ImageGenerationResult,
	type ImageQuality,
	type ImageSize,
	type ImageUsage,
	imageEndpointLabel,
	runImageGeneration,
} from "./image-generation"
import { type ImageAttachment, MAX_ATTACHMENTS, readImageFiles } from "./images"

export type ImageResultEntry = {
	id: string
	prompt: string
	endpoint: "images/generations" | "images/edits"
	model: string
	images: GeneratedImage[]
	usage?: ImageUsage
	referenceNames: string[]
}

export type CoverageCallback = (id: "images-generate" | "images-edit") => void

export type InspectorEntryInput = {
	kind: "request" | "response" | "error"
	label: string
	payload: unknown
}

export type UseImageGenerationOptions = {
	imageModels: string[]
	onCoverage: CoverageCallback
	onEntry: (entry: InspectorEntryInput) => void
}

const newId = (prefix: string) =>
	`${prefix}_${globalThis.crypto.randomUUID().slice(0, 8)}`

export function useImageGeneration({
	imageModels,
	onCoverage,
	onEntry,
}: UseImageGenerationOptions) {
	const [prompt, setPrompt] = useState("")
	const [model, setModel] = useState("")
	const [size, setSize] = useState<ImageSize>("auto")
	const [quality, setQuality] = useState<ImageQuality>("auto")
	const [background, setBackground] = useState<ImageBackground>("auto")
	const [count, setCount] = useState(1)
	const [references, setReferences] = useState<ImageAttachment[]>([])
	const [referenceError, setReferenceError] = useState<string | null>(null)
	const [isGenerating, setIsGenerating] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [results, setResults] = useState<ImageResultEntry[]>([])

	const abortRef = useRef<AbortController | null>(null)

	useEffect(() => {
		setModel((current) =>
			current && imageModels.includes(current)
				? current
				: (imageModels[0] ?? ""),
		)
	}, [imageModels])

	const addReferenceFiles = useCallback(async (files: FileList | File[]) => {
		const list = Array.from(files)
		if (list.length === 0) {
			return
		}

		setReferenceError(null)
		const { attachments: decoded, errors } = await readImageFiles(list)

		setReferences((current) => {
			const merged = [...current, ...decoded]
			const overflow = merged.length - MAX_ATTACHMENTS
			if (overflow > 0) {
				errors.push(
					`Only ${MAX_ATTACHMENTS} reference images at once; dropped the last ${overflow}.`,
				)
			}
			return merged.slice(0, MAX_ATTACHMENTS)
		})

		if (errors.length > 0) {
			setReferenceError(errors.join(" "))
		}
	}, [])

	const removeReference = useCallback((id: string) => {
		setReferences((current) => current.filter((image) => image.id !== id))
	}, [])

	const stop = useCallback(() => {
		abortRef.current?.abort()
	}, [])

	const reset = useCallback(() => {
		abortRef.current?.abort()
		setResults([])
		setError(null)
		setReferences([])
		setReferenceError(null)
	}, [])

	const generate = useCallback(async () => {
		const text = prompt.trim()
		if (!text || isGenerating || !model) {
			return
		}

		setError(null)
		const referenceImages = references

		const controller = new AbortController()
		abortRef.current = controller
		setIsGenerating(true)

		try {
			const result: ImageGenerationResult = await runImageGeneration({
				prompt: text,
				model,
				size,
				quality,
				background,
				count,
				referenceImages,
				signal: controller.signal,
			})

			onEntry({
				kind: "request",
				label: `POST ${imageEndpointLabel[result.endpoint]}`,
				payload: result.requestBody,
			})
			onEntry({
				kind: "response",
				label: imageEndpointLabel[result.endpoint],
				payload: result.responsePayload,
			})
			onCoverage(
				result.endpoint === "images/edits" ? "images-edit" : "images-generate",
			)

			if (result.images.length === 0) {
				throw new Error("The response did not include any images.")
			}

			setResults((current) => [
				{
					id: newId("gen"),
					prompt: text,
					endpoint: result.endpoint,
					model,
					images: result.images,
					usage: result.usage,
					referenceNames: referenceImages.map((image) => image.name),
				},
				...current,
			])
			setPrompt("")
			setReferences([])
		} catch (caught) {
			const message =
				caught instanceof DOMException && caught.name === "AbortError"
					? "Generation stopped."
					: caught instanceof Error
						? caught.message
						: "Image generation failed."
			setError(message)
			onEntry({ kind: "error", label: "error", payload: message })
		} finally {
			abortRef.current = null
			setIsGenerating(false)
		}
	}, [
		prompt,
		model,
		size,
		quality,
		background,
		count,
		references,
		isGenerating,
		onEntry,
		onCoverage,
	])

	return {
		prompt,
		setPrompt,
		model,
		setModel,
		size,
		setSize,
		quality,
		setQuality,
		background,
		setBackground,
		count,
		setCount,
		references,
		addReferenceFiles,
		removeReference,
		referenceError,
		isGenerating,
		error,
		results,
		generate,
		stop,
		reset,
	}
}

export type ImageGenerationController = ReturnType<typeof useImageGeneration>
