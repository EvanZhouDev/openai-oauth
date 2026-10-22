"use client"

import { useEffect, useRef, useState } from "react"
import type { ModelsState } from "../hooks/useModels"
import type { AgentModel } from "../lib/models"
import {
	CheckIcon,
	ChevronDownIcon,
	RefreshIcon,
	SpinnerIcon,
	WarningIcon,
} from "./icons"

export function ModelPicker({
	models,
	value,
	onChange,
}: {
	models: ModelsState
	value?: string
	onChange: (modelId: string) => void
}) {
	const [open, setOpen] = useState(false)
	const anchorRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) {
			return
		}
		const onPointerDown = (event: MouseEvent) => {
			if (!anchorRef.current?.contains(event.target as Node)) {
				setOpen(false)
			}
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpen(false)
			}
		}
		document.addEventListener("pointerdown", onPointerDown)
		document.addEventListener("keydown", onKeyDown)
		return () => {
			document.removeEventListener("pointerdown", onPointerDown)
			document.removeEventListener("keydown", onKeyDown)
		}
	}, [open])

	const selected = models.models.find((model) => model.id === value)
	const standard = models.models.filter((model) => !model.experimental)
	const experimental = models.models.filter((model) => model.experimental)

	const renderItem = (model: AgentModel) => (
		<button
			className="menuItem"
			key={model.id}
			onClick={() => {
				onChange(model.id)
				setOpen(false)
			}}
			type="button"
		>
			<span className="menuItemBody">
				<span className="menuItemTitle">
					{model.label}
					{model.experimental ? (
						<span className="badge experimental">
							{model.supportedInApi ? "hidden" : "no api"}
						</span>
					) : null}
				</span>
				<span className="menuItemDescription">
					{model.id} · {model.description}
				</span>
			</span>
			{model.id === value ? <CheckIcon className="icon sm check" /> : null}
		</button>
	)

	return (
		<div className="menuAnchor" ref={anchorRef}>
			<button
				aria-expanded={open}
				aria-haspopup="menu"
				className="modelButton"
				onClick={() => setOpen((current) => !current)}
				type="button"
			>
				{models.loading && models.models.length === 0 ? (
					<>
						<SpinnerIcon className="icon sm spin" />
						<span className="modelSuffix">Loading models</span>
					</>
				) : (
					<>
						<span>{selected?.label ?? value ?? "Select a model"}</span>
						{selected?.experimental ? (
							<span className="badge experimental">hidden</span>
						) : null}
						<ChevronDownIcon className="icon sm" />
					</>
				)}
			</button>

			{open ? (
				<div className="menu" role="menu">
					{models.warning ? (
						<div
							className="menuFooter"
							style={{ color: "var(--danger)", paddingTop: 10 }}
						>
							<WarningIcon className="icon sm" />
							<span>{models.warning}</span>
						</div>
					) : null}

					{models.error ? (
						<div className="errorBanner" style={{ margin: 6 }}>
							<WarningIcon className="icon sm" />
							<span>{models.error}</span>
						</div>
					) : null}

					{standard.length > 0 ? (
						<>
							<div className="menuLabel">Models</div>
							{standard.map(renderItem)}
						</>
					) : null}

					{experimental.length > 0 ? (
						<>
							<div className="menuDivider" />
							<div className="menuLabel">Hidden &amp; unlisted</div>
							{experimental.map(renderItem)}
						</>
					) : null}

					<div className="menuDivider" />
					<button
						className="menuItem"
						onClick={() => void models.refresh()}
						type="button"
					>
						<span className="menuItemBody">
							<span className="menuItemTitle">
								{models.loading ? (
									<SpinnerIcon className="icon sm spin" />
								) : (
									<RefreshIcon className="icon sm" />
								)}
								Refresh model list
							</span>
							<span className="menuItemDescription">
								Read live from your account, including models the public list
								hides. What shows up is whatever OpenAI serves your plan.
							</span>
						</span>
					</button>
					<div className="menuFooter">
						{models.models.length} models
						{models.clientVersion ? ` · codex ${models.clientVersion}` : ""}
						{models.source === "openai-compatible" ? " · public list only" : ""}
						{models.source === "fallback" ? " · offline list" : ""}
					</div>
				</div>
			) : null}
		</div>
	)
}
