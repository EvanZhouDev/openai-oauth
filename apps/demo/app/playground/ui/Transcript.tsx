"use client"

import { useState } from "react"
import type { HistoryItem, ToolCallRecord } from "../lib/types"
import { BrainIcon, ChevronIcon, ToolIcon } from "./icons"

const formatJson = (value: string): string => {
	const trimmed = value.trim()
	if (trimmed.length === 0) {
		return "{}"
	}
	try {
		return JSON.stringify(JSON.parse(trimmed), null, 2)
	} catch {
		// Arguments stream in one character at a time, so partial JSON is normal.
		return trimmed
	}
}

const usageSummary = (item: Extract<HistoryItem, { kind: "assistant" }>) => {
	const meta = item.meta
	if (!meta) {
		return null
	}

	const parts = [
		meta.model,
		meta.endpoint === "responses" ? "/v1/responses" : "/v1/chat/completions",
	]
	parts.push(meta.stream ? "streamed" : "non-streamed")
	if (meta.rounds > 1) {
		parts.push(`${meta.rounds} requests`)
	}
	if (meta.latencyMs != null) {
		parts.push(`${(meta.latencyMs / 1000).toFixed(1)}s`)
	}
	if (meta.finishReason) {
		parts.push(meta.finishReason)
	}
	if (meta.usage?.total != null) {
		parts.push(`${meta.usage.total} tokens`)
	}
	if (meta.usage?.reasoning != null && meta.usage.reasoning > 0) {
		parts.push(`${meta.usage.reasoning} reasoning`)
	}

	return parts.join(" · ")
}

function ToolCallCard({ call }: { call: ToolCallRecord }) {
	const [isOpen, setIsOpen] = useState(true)

	return (
		<div className={`toolCall toolCall--${call.status}`}>
			<button
				aria-expanded={isOpen}
				className="toolCallHeader"
				onClick={() => setIsOpen((open) => !open)}
				type="button"
			>
				<span className={`disclosure ${isOpen ? "isOpen" : ""}`}>
					<ChevronIcon />
				</span>
				<ToolIcon />
				<code>{call.name}</code>
				<span className="toolCallStatus">
					{call.status === "streaming"
						? "receiving arguments"
						: call.status === "running"
							? "running"
							: call.status === "error"
								? "failed"
								: "done"}
				</span>
			</button>
			{isOpen ? (
				<div className="toolCallBody">
					<span className="toolCallLabel">arguments</span>
					<pre>{formatJson(call.arguments)}</pre>
					{call.result !== undefined ? (
						<>
							<span className="toolCallLabel">result</span>
							<pre>{formatJson(call.result)}</pre>
						</>
					) : null}
					{call.error ? <p className="toolCallError">{call.error}</p> : null}
				</div>
			) : null}
		</div>
	)
}

function ReasoningBlock({ text, live }: { text: string; live: boolean }) {
	const [isOpen, setIsOpen] = useState(true)

	return (
		<div className="reasoning">
			<button
				aria-expanded={isOpen}
				className="reasoningHeader"
				onClick={() => setIsOpen((open) => !open)}
				type="button"
			>
				<span className={`disclosure ${isOpen ? "isOpen" : ""}`}>
					<ChevronIcon />
				</span>
				<BrainIcon />
				<span>{live ? "Thinking..." : "Reasoning trace"}</span>
			</button>
			{isOpen ? <div className="reasoningBody">{text}</div> : null}
		</div>
	)
}

export function Transcript({
	items,
	isRunning,
}: {
	items: HistoryItem[]
	isRunning: boolean
}) {
	const lastAssistantId = [...items]
		.reverse()
		.find((item) => item.kind === "assistant")?.id

	return (
		<div className="transcript">
			{items.map((item) => {
				if (item.kind === "tool") {
					// Rendered inside the assistant turn that requested it.
					return null
				}

				if (item.kind === "user") {
					return (
						<article className="turn turn--user" key={item.id}>
							{item.images && item.images.length > 0 ? (
								<div className="userImages">
									{item.images.map((image) => (
										// biome-ignore lint/performance/noImgElement: data URLs, not files next/image can optimize
										<img
											alt={image.name}
											height={image.height}
											key={image.id}
											src={image.dataUrl}
											width={image.width}
										/>
									))}
								</div>
							) : null}
							{item.text.length > 0 ? (
								<div className="bubble">{item.text}</div>
							) : null}
						</article>
					)
				}

				const isLive = isRunning && item.id === lastAssistantId
				const isEmpty =
					item.text.length === 0 &&
					item.reasoning.length === 0 &&
					item.toolCalls.length === 0

				return (
					<article className="turn turn--assistant" key={item.id}>
						{item.reasoning.length > 0 ? (
							<ReasoningBlock
								live={isLive && item.text.length === 0}
								text={item.reasoning}
							/>
						) : null}

						{item.toolCalls.map((call) => (
							<ToolCallCard call={call} key={call.callId} />
						))}

						{item.text.length > 0 ? (
							<div className="assistantText">{item.text}</div>
						) : null}

						{isEmpty && isLive ? (
							<output className="thinkingDots">
								<span />
								<span />
								<span />
							</output>
						) : null}

						{item.meta ? (
							<p className="turnMeta">{usageSummary(item)}</p>
						) : null}
					</article>
				)
			})}
		</div>
	)
}
