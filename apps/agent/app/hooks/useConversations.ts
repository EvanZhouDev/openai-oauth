"use client"

import type { UIMessage } from "ai"
import { useCallback, useEffect, useRef, useState } from "react"
import { DEFAULT_ROLE_ID } from "../lib/roles"
import type { Conversation } from "../lib/types"

const STORAGE_KEY = "agent.conversations.v1"
const MAX_CONVERSATIONS = 200

export const createConversationId = (): string =>
	`c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export const emptyConversation = (
	roleId = DEFAULT_ROLE_ID,
	customInstructions = "",
): Conversation => ({
	id: createConversationId(),
	title: "New chat",
	createdAt: Date.now(),
	updatedAt: Date.now(),
	roleId,
	customInstructions,
	messages: [],
})

const readStorage = (): Conversation[] => {
	if (typeof window === "undefined") {
		return []
	}
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY)
		if (!raw) {
			return []
		}
		const parsed: unknown = JSON.parse(raw)
		if (!Array.isArray(parsed)) {
			return []
		}
		return parsed.filter(
			(item): item is Conversation =>
				typeof item === "object" &&
				item !== null &&
				typeof (item as Conversation).id === "string",
		)
	} catch {
		return []
	}
}

/**
 * Chat history lives in the browser, next to the encrypted OAuth session —
 * the server never sees a conversation it is not actively answering.
 */
export const useConversations = () => {
	const [conversations, setConversations] = useState<Conversation[]>([])
	const [loaded, setLoaded] = useState(false)
	const writeTimer = useRef<number | undefined>(undefined)

	useEffect(() => {
		setConversations(readStorage())
		setLoaded(true)
	}, [])

	useEffect(() => {
		if (!loaded) {
			return
		}
		window.clearTimeout(writeTimer.current)
		writeTimer.current = window.setTimeout(() => {
			try {
				window.localStorage.setItem(
					STORAGE_KEY,
					JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS)),
				)
			} catch {
				// Storage full or blocked — history simply stops persisting.
			}
		}, 250)
		return () => window.clearTimeout(writeTimer.current)
	}, [conversations, loaded])

	const upsert = useCallback((conversation: Conversation) => {
		setConversations((current) => {
			const next = current.filter((item) => item.id !== conversation.id)
			return [conversation, ...next]
		})
	}, [])

	const patch = useCallback((id: string, changes: Partial<Conversation>) => {
		setConversations((current) =>
			current.map((item) =>
				item.id === id ? { ...item, ...changes, updatedAt: Date.now() } : item,
			),
		)
	}, [])

	const saveMessages = useCallback((id: string, messages: UIMessage[]) => {
		setConversations((current) => {
			const existing = current.find((item) => item.id === id)
			if (!existing) {
				return current
			}
			if (existing.messages === messages) {
				return current
			}
			const updated: Conversation = {
				...existing,
				messages,
				updatedAt: Date.now(),
			}
			return [updated, ...current.filter((item) => item.id !== id)]
		})
	}, [])

	const remove = useCallback((id: string) => {
		setConversations((current) => current.filter((item) => item.id !== id))
	}, [])

	const clearAll = useCallback(() => setConversations([]), [])

	return {
		conversations,
		loaded,
		upsert,
		patch,
		saveMessages,
		remove,
		clearAll,
	}
}

const DAY_MS = 24 * 60 * 60 * 1000

export const groupConversations = (
	conversations: Conversation[],
): Array<{ label: string; items: Conversation[] }> => {
	const now = Date.now()
	const today: Conversation[] = []
	const week: Conversation[] = []
	const month: Conversation[] = []
	const older: Conversation[] = []

	for (const conversation of conversations) {
		const age = now - conversation.updatedAt
		if (age < DAY_MS) {
			today.push(conversation)
		} else if (age < 7 * DAY_MS) {
			week.push(conversation)
		} else if (age < 30 * DAY_MS) {
			month.push(conversation)
		} else {
			older.push(conversation)
		}
	}

	return [
		{ label: "Today", items: today },
		{ label: "Previous 7 days", items: week },
		{ label: "Previous 30 days", items: month },
		{ label: "Older", items: older },
	].filter((group) => group.items.length > 0)
}
