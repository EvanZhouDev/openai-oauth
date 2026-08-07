"use client"

import { parseJwtClaims } from "@openai-oauth/core"
import { useSignInWithChatGPT } from "@openai-oauth/react"
import type { UIMessage } from "ai"
import { useCallback, useEffect, useMemo, useState } from "react"
import { emptyConversation, useConversations } from "../hooks/useConversations"
import { useModels } from "../hooks/useModels"
import {
	downloadAllConversations,
	downloadConversationMarkdown,
} from "../lib/export"
import { DEFAULT_ROLE_ID, roleById } from "../lib/roles"
import type { Conversation, Settings } from "../lib/types"
import { ChatView } from "./ChatView"
import { FilesPanel } from "./FilesPanel"
import {
	DownloadIcon,
	FolderIcon,
	MoonIcon,
	NewChatIcon,
	SettingsIcon,
	SidebarIcon,
	SunIcon,
} from "./icons"
import { ModelPicker } from "./ModelPicker"
import { SettingsDialog } from "./SettingsDialog"
import { Sidebar } from "./Sidebar"
import { SignIn } from "./SignIn"

const SETTINGS_KEY = "agent.settings.v1"
const MODEL_KEY = "agent.model.v1"

const defaultSettings = (): Settings => ({
	roleId: DEFAULT_ROLE_ID,
	customInstructions: "",
	reasoningEffort: "off",
	theme: "dark",
	autoTitle: true,
})

const readSettings = (): Settings => {
	if (typeof window === "undefined") {
		return defaultSettings()
	}
	try {
		const raw = window.localStorage.getItem(SETTINGS_KEY)
		const stored = raw ? (JSON.parse(raw) as Partial<Settings>) : {}
		const theme =
			stored.theme ??
			((document.documentElement.dataset.theme as Settings["theme"]) ||
				defaultSettings().theme)
		return { ...defaultSettings(), ...stored, theme }
	} catch {
		return defaultSettings()
	}
}

export function AgentApp() {
	const auth = useSignInWithChatGPT()
	const isSignedIn = auth.status === "signed-in"

	const { conversations, loaded, upsert, patch, saveMessages, remove } =
		useConversations()
	const models = useModels(isSignedIn)

	const [settings, setSettings] = useState<Settings>(defaultSettings)
	const [settingsOpen, setSettingsOpen] = useState(false)
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
	const [filesOpen, setFilesOpen] = useState(false)
	const [workspaceToken, setWorkspaceToken] = useState(0)
	const [activeId, setActiveId] = useState<string | undefined>(undefined)
	const [model, setModel] = useState<string | undefined>(undefined)

	useEffect(() => {
		setSettings(readSettings())
		setModel(window.localStorage.getItem(MODEL_KEY) ?? undefined)
		setSidebarCollapsed(window.matchMedia("(max-width: 768px)").matches)
	}, [])

	useEffect(() => {
		document.documentElement.dataset.theme = settings.theme
		try {
			window.localStorage.setItem("agent.theme", settings.theme)
			window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
		} catch {
			// Private browsing — settings simply do not persist.
		}
	}, [settings])

	// Fall back to the account's best available model until one is chosen.
	useEffect(() => {
		if (models.models.length === 0) {
			return
		}
		setModel((current) =>
			current && models.models.some((item) => item.id === current)
				? current
				: models.defaultModel,
		)
	}, [models.models, models.defaultModel])

	useEffect(() => {
		if (model) {
			try {
				window.localStorage.setItem(MODEL_KEY, model)
			} catch {}
		}
	}, [model])

	// Always have a conversation to type into.
	useEffect(() => {
		if (!loaded) {
			return
		}
		if (activeId && conversations.some((item) => item.id === activeId)) {
			return
		}
		const first = conversations[0]
		if (first) {
			setActiveId(first.id)
			return
		}
		const fresh = emptyConversation(
			settings.roleId,
			settings.customInstructions,
		)
		upsert(fresh)
		setActiveId(fresh.id)
	}, [loaded, conversations, activeId, settings, upsert])

	const conversation: Conversation | undefined = useMemo(
		() => conversations.find((item) => item.id === activeId),
		[conversations, activeId],
	)

	const newChat = useCallback(() => {
		const fresh = emptyConversation(
			settings.roleId,
			settings.customInstructions,
		)
		upsert(fresh)
		setActiveId(fresh.id)
		if (window.matchMedia("(max-width: 768px)").matches) {
			setSidebarCollapsed(true)
		}
	}, [settings, upsert])

	const handleMessages = useCallback(
		(messages: UIMessage[]) => {
			if (activeId) {
				saveMessages(activeId, messages)
			}
		},
		[activeId, saveMessages],
	)

	const handleTitle = useCallback(
		(title: string) => {
			if (activeId) {
				patch(activeId, { title })
			}
		},
		[activeId, patch],
	)

	const handleDelete = useCallback(
		(id: string) => {
			remove(id)
			if (id === activeId) {
				setActiveId(undefined)
			}
		},
		[activeId, remove],
	)

	// Stable identity: ChatView re-runs its post-turn effect when this changes.
	const handleWorkspaceChanged = useCallback(
		() => setWorkspaceToken((token) => token + 1),
		[],
	)

	const accountLabel = useMemo(() => {
		const claims = parseJwtClaims(auth.session?.idToken)
		const email = typeof claims?.email === "string" ? claims.email : undefined
		return email ?? auth.session?.accountId?.slice(0, 12) ?? "ChatGPT account"
	}, [auth.session])

	if (!isSignedIn) {
		return (
			<SignIn
				error={auth.error?.message}
				installUrl={
					auth.status === "needs-extension" ? auth.installUrl : undefined
				}
				onCancel={() => void auth.reset()}
				onSignIn={() => void auth.login()}
				status={auth.status}
			/>
		)
	}

	const modelInfo = models.models.find((item) => item.id === model)
	const roleName = roleById(settings.roleId).name

	return (
		<div className="app">
			<Sidebar
				accountLabel={accountLabel}
				activeId={activeId}
				collapsed={sidebarCollapsed}
				conversations={conversations}
				onDelete={handleDelete}
				onNewChat={newChat}
				onOpenFiles={() => setFilesOpen(true)}
				onOpenSettings={() => setSettingsOpen(true)}
				onRename={(id, title) => patch(id, { title })}
				onSelect={(id) => {
					setActiveId(id)
					if (window.matchMedia("(max-width: 768px)").matches) {
						setSidebarCollapsed(true)
					}
				}}
				onExportAll={() => downloadAllConversations(conversations)}
				onSignOut={() => void auth.logout()}
				onToggle={() => setSidebarCollapsed(true)}
			/>

			{!sidebarCollapsed ? (
				<button
					aria-label="Close sidebar"
					className="scrim mobileOnly"
					onClick={() => setSidebarCollapsed(true)}
					type="button"
				/>
			) : null}

			<div className="main">
				<header className="topBar">
					{sidebarCollapsed ? (
						<>
							<button
								aria-label="Open sidebar"
								className="iconButton"
								onClick={() => setSidebarCollapsed(false)}
								type="button"
							>
								<SidebarIcon />
							</button>
							<button
								aria-label="New chat"
								className="iconButton"
								onClick={newChat}
								type="button"
							>
								<NewChatIcon />
							</button>
						</>
					) : null}

					<ModelPicker models={models} onChange={setModel} value={model} />

					<span className="topBarSpacer" />

					<button
						className="pill"
						onClick={() => setSettingsOpen(true)}
						title="Change role or system prompt"
						type="button"
					>
						<SettingsIcon className="icon sm" />
						<span className="pillLabel">{roleName}</span>
					</button>
					<button
						aria-label="Download this chat as Markdown"
						className="iconButton"
						disabled={!conversation || conversation.messages.length === 0}
						onClick={() =>
							conversation && downloadConversationMarkdown(conversation)
						}
						title="Download this chat (.md)"
						type="button"
					>
						<DownloadIcon />
					</button>
					<button
						aria-label="Toggle theme"
						className="iconButton"
						onClick={() =>
							setSettings((current) => ({
								...current,
								theme: current.theme === "dark" ? "light" : "dark",
							}))
						}
						type="button"
					>
						{settings.theme === "dark" ? <SunIcon /> : <MoonIcon />}
					</button>
					<button
						aria-label="Workspace files"
						className={`iconButton ${filesOpen ? "active" : ""}`}
						onClick={() => setFilesOpen((current) => !current)}
						type="button"
					>
						<FolderIcon />
					</button>
				</header>

				{conversation ? (
					<ChatView
						conversation={conversation}
						key={conversation.id}
						model={model}
						modelInfo={modelInfo}
						onMessagesChange={handleMessages}
						onTitle={handleTitle}
						onWorkspaceChanged={handleWorkspaceChanged}
						settings={settings}
					/>
				) : null}
			</div>

			{filesOpen && conversation ? (
				<FilesPanel
					onClose={() => setFilesOpen(false)}
					refreshToken={workspaceToken}
					sessionId={conversation.id}
				/>
			) : null}

			{settingsOpen ? (
				<SettingsDialog
					modelLabel={modelInfo?.label}
					modelLevels={modelInfo?.reasoningLevels}
					onClose={() => setSettingsOpen(false)}
					onSave={(next) => {
						setSettings(next)
						setSettingsOpen(false)
					}}
					settings={settings}
				/>
			) : null}
		</div>
	)
}
