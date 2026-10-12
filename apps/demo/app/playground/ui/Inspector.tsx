"use client"

import { useState } from "react"
import type { InspectorEntry } from "../lib/types"
import { ChevronIcon } from "./icons"

const formatTime = (at: number) =>
	new Date(at).toLocaleTimeString(undefined, {
		hour12: false,
		minute: "2-digit",
		second: "2-digit",
	})

function InspectorRow({ entry }: { entry: InspectorEntry }) {
	const [isOpen, setIsOpen] = useState(false)

	return (
		<li className={`inspectorRow inspectorRow--${entry.kind}`}>
			<button
				aria-expanded={isOpen}
				className="inspectorRowHeader"
				onClick={() => setIsOpen((open) => !open)}
				type="button"
			>
				<span className={`disclosure ${isOpen ? "isOpen" : ""}`}>
					<ChevronIcon />
				</span>
				<span className="inspectorTime">{formatTime(entry.at)}</span>
				<span className="inspectorLabel">{entry.label}</span>
			</button>
			{isOpen ? (
				<pre className="inspectorPayload">
					{JSON.stringify(entry.payload, null, 2)}
				</pre>
			) : null}
		</li>
	)
}

export function Inspector({
	entries,
	hideDeltas,
	onHideDeltasChange,
	onClear,
}: {
	entries: InspectorEntry[]
	hideDeltas: boolean
	onHideDeltasChange: (value: boolean) => void
	onClear: () => void
}) {
	return (
		<section aria-label="Network inspector" className="inspector">
			<header className="inspectorHeader">
				<h2>Wire inspector</h2>
				<div className="inspectorActions">
					<label className="checkbox">
						<input
							checked={hideDeltas}
							onChange={(event) => onHideDeltasChange(event.target.checked)}
							type="checkbox"
						/>
						<span>Hide deltas</span>
					</label>
					<button onClick={onClear} type="button">
						Clear
					</button>
				</div>
			</header>

			{entries.length === 0 ? (
				<p className="inspectorEmpty">
					Every request body and SSE frame exchanged with the gateway shows up
					here.
				</p>
			) : (
				<ul className="inspectorList">
					{entries.map((entry) => (
						<InspectorRow entry={entry} key={entry.id} />
					))}
				</ul>
			)}
		</section>
	)
}
