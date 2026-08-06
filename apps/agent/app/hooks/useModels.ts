"use client"

import { openaiAuthHeaders } from "@openai-oauth/react"
import { useCallback, useEffect, useState } from "react"
import type { AgentModel } from "../lib/models"

type ModelsResponse = {
	models?: AgentModel[]
	defaultModel?: string
	clientVersion?: string
	source?: string
	error?: string
}

export type ModelsState = {
	models: AgentModel[]
	defaultModel?: string
	clientVersion?: string
	source?: string
	loading: boolean
	error?: string
	refresh: () => Promise<void>
}

/**
 * Loads the live model list on every mount, so a refresh of the page is all it
 * takes to see a model OpenAI has just made available to Codex clients.
 */
export const useModels = (enabled: boolean): ModelsState => {
	const [state, setState] = useState<Omit<ModelsState, "refresh">>({
		models: [],
		loading: enabled,
	})

	const refresh = useCallback(async () => {
		setState((current) => ({ ...current, loading: true, error: undefined }))
		try {
			const response = await fetch("/api/models", {
				headers: await openaiAuthHeaders(),
				cache: "no-store",
			})
			const payload = (await response.json()) as ModelsResponse
			if (!response.ok || !payload.models) {
				throw new Error(payload.error ?? "Could not load the model list.")
			}
			setState({
				models: payload.models,
				defaultModel: payload.defaultModel,
				clientVersion: payload.clientVersion,
				source: payload.source,
				loading: false,
			})
		} catch (error) {
			setState((current) => ({
				...current,
				loading: false,
				error: error instanceof Error ? error.message : String(error),
			}))
		}
	}, [])

	useEffect(() => {
		if (enabled) {
			void refresh()
		}
	}, [enabled, refresh])

	return { ...state, refresh }
}
