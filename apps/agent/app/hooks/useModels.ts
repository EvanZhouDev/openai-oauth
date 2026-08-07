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
	warning?: string
}

export type ModelsState = {
	models: AgentModel[]
	defaultModel?: string
	clientVersion?: string
	source?: string
	loading: boolean
	error?: string
	warning?: string
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
			// An empty or non-JSON body used to surface as "Unexpected end of JSON
			// input", which told the user nothing about what actually failed.
			const raw = await response.text()
			let payload: ModelsResponse = {}
			if (raw.trim().length > 0) {
				try {
					payload = JSON.parse(raw) as ModelsResponse
				} catch {
					throw new Error(
						`The model list came back unreadable (HTTP ${response.status}). ${raw.slice(0, 160)}`,
					)
				}
			}
			if (!response.ok || !payload.models || payload.models.length === 0) {
				throw new Error(
					payload.error ??
						`Could not load the model list (HTTP ${response.status}).`,
				)
			}
			setState({
				models: payload.models,
				defaultModel: payload.defaultModel,
				clientVersion: payload.clientVersion,
				source: payload.source,
				warning: payload.warning,
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
