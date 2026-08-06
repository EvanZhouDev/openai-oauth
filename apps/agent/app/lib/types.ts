import type { UIMessage } from "ai"

export type Conversation = {
	id: string
	title: string
	createdAt: number
	updatedAt: number
	model?: string
	roleId: string
	customInstructions: string
	messages: UIMessage[]
}

export type Attachment = {
	id: string
	name: string
	path: string
	mediaType: string
	bytes: number
	isImage: boolean
	isText: boolean
	dataUrl?: string
	status: "uploading" | "ready" | "error"
	error?: string
}

/** "off" means: send nothing and let the model use its own default. */
export type ReasoningEffort = string

export type Settings = {
	roleId: string
	customInstructions: string
	reasoningEffort: ReasoningEffort
	theme: "light" | "dark"
	autoTitle: boolean
}

export type PlanStep = {
	title: string
	status: "pending" | "in_progress" | "completed"
}
