import type { UIMessage } from "ai"
import type { Conversation } from "./types"

const partToMarkdown = (part: UIMessage["parts"][number]): string => {
	if (part.type === "text") {
		return (part as { text: string }).text
	}
	if (part.type === "reasoning") {
		const text = (part as { text: string }).text.trim()
		return text.length > 0 ? `> _Thinking:_ ${text.replace(/\n/g, "\n> ")}` : ""
	}
	if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
		const tool = part as unknown as {
			type: string
			input?: unknown
			output?: unknown
		}
		const name = tool.type.replace(/^tool-/, "")
		const input = JSON.stringify(tool.input ?? {}, null, 2)
		const output =
			typeof tool.output === "string"
				? tool.output
				: JSON.stringify(tool.output ?? {}, null, 2)
		return [
			`<details><summary>🛠 ${name}</summary>`,
			"",
			"```json",
			input.slice(0, 4000),
			"```",
			"",
			"```json",
			output.slice(0, 4000),
			"```",
			"",
			"</details>",
		].join("\n")
	}
	return ""
}

/** Renders a stored conversation as a Markdown transcript. */
export const conversationToMarkdown = (conversation: Conversation): string => {
	const header = [
		`# ${conversation.title}`,
		"",
		`_${new Date(conversation.createdAt).toLocaleString()}${conversation.model ? ` · ${conversation.model}` : ""}_`,
		"",
	]

	const body = conversation.messages.flatMap((message) => {
		const rendered = message.parts
			.map(partToMarkdown)
			.filter((chunk) => chunk.trim().length > 0)
			.join("\n\n")
		if (rendered.trim().length === 0) {
			return []
		}
		return [`## ${message.role === "user" ? "You" : "Agent"}`, "", rendered, ""]
	})

	return [...header, ...body].join("\n")
}

const download = (filename: string, content: string, mediaType: string) => {
	const url = URL.createObjectURL(new Blob([content], { type: mediaType }))
	const link = document.createElement("a")
	link.href = url
	link.download = filename
	document.body.append(link)
	link.click()
	link.remove()
	window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const safeFilename = (title: string): string =>
	title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 48) || "chat"

export const downloadConversationMarkdown = (conversation: Conversation) => {
	download(
		`${safeFilename(conversation.title)}.md`,
		conversationToMarkdown(conversation),
		"text/markdown;charset=utf-8",
	)
}

export const downloadConversationJson = (conversation: Conversation) => {
	download(
		`${safeFilename(conversation.title)}.json`,
		JSON.stringify(conversation, null, 2),
		"application/json",
	)
}

/** Exports every chat in the browser, for backup or moving to another machine. */
export const downloadAllConversations = (conversations: Conversation[]) => {
	download(
		`agent-chats-${new Date().toISOString().slice(0, 10)}.json`,
		JSON.stringify(conversations, null, 2),
		"application/json",
	)
}
