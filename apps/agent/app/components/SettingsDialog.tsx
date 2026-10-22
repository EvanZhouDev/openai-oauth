"use client"

import { useEffect, useState } from "react"
import { ROLES } from "../lib/roles"
import type { ReasoningEffort, Settings } from "../lib/types"
import { CloseIcon, MoonIcon, SunIcon } from "./icons"

const FALLBACK_EFFORTS = ["low", "medium", "high"]

export function SettingsDialog({
	settings,
	modelLevels,
	modelLabel,
	onClose,
	onSave,
}: {
	settings: Settings
	/** Effort levels the selected model advertises; anything else is rejected. */
	modelLevels?: string[]
	modelLabel?: string
	onClose: () => void
	onSave: (settings: Settings) => void
}) {
	const efforts = [
		"off",
		...(modelLevels && modelLevels.length > 0 ? modelLevels : FALLBACK_EFFORTS),
	]
	const [draft, setDraft] = useState<Settings>(settings)

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose()
			}
		}
		document.addEventListener("keydown", onKeyDown)
		return () => document.removeEventListener("keydown", onKeyDown)
	}, [onClose])

	const role = ROLES.find((item) => item.id === draft.roleId)

	return (
		<div className="overlay">
			<button
				aria-label="Close settings"
				className="dialogScrim"
				onClick={onClose}
				type="button"
			/>
			<div
				aria-label="Agent settings"
				aria-modal="true"
				className="dialog"
				role="dialog"
			>
				<div className="dialogHeader">
					<span>Agent settings</span>
					<button
						aria-label="Close settings"
						className="iconButton"
						onClick={onClose}
						type="button"
					>
						<CloseIcon />
					</button>
				</div>

				<div className="dialogBody">
					<div className="field">
						<span className="fieldLabel">Role</span>
						<div className="roleGrid">
							{ROLES.map((item) => (
								<button
									className={`roleCard ${draft.roleId === item.id ? "selected" : ""}`}
									key={item.id}
									onClick={() => setDraft({ ...draft, roleId: item.id })}
									type="button"
								>
									<strong>{item.name}</strong>
									<span>{item.tagline}</span>
								</button>
							))}
						</div>
						{role && role.id !== "custom" ? (
							<p className="fieldHint">{role.instructions}</p>
						) : null}
					</div>

					<div className="field">
						<label htmlFor="custom-instructions">
							{draft.roleId === "custom"
								? "System prompt"
								: "Extra instructions"}
						</label>
						<textarea
							id="custom-instructions"
							onChange={(event) =>
								setDraft({ ...draft, customInstructions: event.target.value })
							}
							placeholder={
								draft.roleId === "custom"
									? "You are…"
									: "Anything the agent should always keep in mind: your stack, conventions, tone."
							}
							rows={6}
							value={draft.customInstructions}
						/>
						<p className="fieldHint">
							{draft.roleId === "custom"
								? "Replaces the role instructions. The agent's tool and sandbox rules always stay in place."
								: "Added on top of the selected role, for every new message in this chat."}
						</p>
					</div>

					<div className="field">
						<span className="fieldLabel">Reasoning effort</span>
						<div className="segmented">
							{efforts.map((effort) => (
								<button
									className={draft.reasoningEffort === effort ? "selected" : ""}
									key={effort}
									onClick={() =>
										setDraft({
											...draft,
											reasoningEffort: effort as ReasoningEffort,
										})
									}
									type="button"
								>
									{effort}
								</button>
							))}
						</div>
						<p className="fieldHint">
							Higher effort thinks longer before acting.{" "}
							{modelLabel
								? `These are the levels ${modelLabel} accepts.`
								: "These levels come from the selected model."}{" "}
							"off" leaves the choice to the model's own default.
						</p>
					</div>

					<div className="field">
						<span className="fieldLabel">Appearance</span>
						<div className="segmented">
							<button
								className={draft.theme === "light" ? "selected" : ""}
								onClick={() => setDraft({ ...draft, theme: "light" })}
								type="button"
							>
								<SunIcon className="icon xs" /> Light
							</button>
							<button
								className={draft.theme === "dark" ? "selected" : ""}
								onClick={() => setDraft({ ...draft, theme: "dark" })}
								type="button"
							>
								<MoonIcon className="icon xs" /> Dark
							</button>
						</div>
					</div>

					<div className="field">
						<span className="fieldLabel">Chat titles</span>
						<div className="segmented">
							<button
								className={draft.autoTitle ? "selected" : ""}
								onClick={() => setDraft({ ...draft, autoTitle: true })}
								type="button"
							>
								Name chats automatically
							</button>
							<button
								className={draft.autoTitle ? "" : "selected"}
								onClick={() => setDraft({ ...draft, autoTitle: false })}
								type="button"
							>
								Keep the first message
							</button>
						</div>
					</div>
				</div>

				<div className="dialogFooter">
					<button className="buttonGhost" onClick={onClose} type="button">
						Cancel
					</button>
					<button
						className="buttonPrimary"
						onClick={() => onSave(draft)}
						type="button"
					>
						Save
					</button>
				</div>
			</div>
		</div>
	)
}
