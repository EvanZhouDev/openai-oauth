"use client"

import { useEffect, useState } from "react"
import {
	BrandIcon,
	CheckIcon,
	FolderIcon,
	GlobeIcon,
	ImageIcon,
	LockIcon,
	SparkleIcon,
	SpinnerIcon,
	TerminalIcon,
	WarningIcon,
} from "./icons"

const FEATURES = [
	{ icon: TerminalIcon, label: "Sandbox terminal" },
	{ icon: FolderIcon, label: "Reads and writes real files" },
	{ icon: GlobeIcon, label: "Web search" },
	{ icon: ImageIcon, label: "Image generation" },
	{ icon: SparkleIcon, label: "Every model on your account" },
]

const STUCK_AFTER_MS = 12_000

const storeName = (installUrl: string): string =>
	installUrl.includes("addons.mozilla.org")
		? "Firefox Add-ons"
		: "the Chrome Web Store"

export function SignIn({
	status,
	error,
	installUrl,
	onSignIn,
	onCancel,
}: {
	status: string
	error?: string
	installUrl?: string
	onSignIn: () => void
	onCancel: () => void
}) {
	const busy =
		status === "checking" || status === "starting" || status === "redirecting"
	const [stuck, setStuck] = useState(false)

	// A hosted app that never comes back should say so instead of spinning.
	useEffect(() => {
		if (!busy) {
			setStuck(false)
			return
		}
		const timer = window.setTimeout(() => setStuck(true), STUCK_AFTER_MS)
		return () => window.clearTimeout(timer)
	}, [busy])

	// Hosted apps (Replit, Vercel, anything that is not localhost) complete the
	// OAuth handoff through the Sign in with ChatGPT extension.
	if (status === "needs-extension" && installUrl) {
		return (
			<main className="signIn">
				<BrandIcon className="icon" />
				<h1>One more step</h1>
				<p>
					This app is hosted, so the ChatGPT sign-in handoff goes through the
					open-source <strong>Sign in with ChatGPT</strong> extension. Install
					it once from {storeName(installUrl)}, then come back and continue.
				</p>

				<div
					style={{
						display: "flex",
						gap: 10,
						flexWrap: "wrap",
						justifyContent: "center",
						marginTop: 10,
					}}
				>
					<a
						className="buttonPrimary"
						href={installUrl}
						rel="noreferrer noopener"
						target="_blank"
					>
						Install the extension
					</a>
					<button className="buttonGhost" onClick={onSignIn} type="button">
						<CheckIcon className="icon sm" />
						I've installed it — continue
					</button>
				</div>

				<button
					className="buttonGhost"
					onClick={onCancel}
					style={{ border: "none", marginTop: 4 }}
					type="button"
				>
					Cancel
				</button>

				<span className="signInNote">
					<LockIcon className="icon xs" />
					Running it locally with `bun run dev` needs no extension.
				</span>
			</main>
		)
	}

	return (
		<main className="signIn">
			<BrandIcon className="icon" />
			<h1>Your own coding agent</h1>
			<p>
				A ChatGPT-style workspace that plans, writes code, runs it in a sandbox
				and searches the web — powered by your own ChatGPT account, with no API
				key.
			</p>

			<div className="featureRow">
				{FEATURES.map((feature) => (
					<span className="featureChip" key={feature.label}>
						<feature.icon className="icon sm" />
						{feature.label}
					</span>
				))}
			</div>

			<button
				className="buttonPrimary"
				disabled={busy}
				onClick={onSignIn}
				style={{ marginTop: 18, height: 48, padding: "0 22px", fontSize: 16 }}
				type="button"
			>
				{busy ? (
					<SpinnerIcon className="icon sm spin" />
				) : (
					<BrandIcon className="icon sm" />
				)}
				{busy ? "Connecting…" : "Sign in with ChatGPT"}
			</button>

			<span className="signInNote">
				<LockIcon className="icon xs" />
				Credentials are encrypted and stored only in this browser.
			</span>

			{stuck ? (
				<div className="errorBanner" style={{ maxWidth: 460 }}>
					<WarningIcon className="icon sm" />
					<span>
						This is taking longer than expected. If a popup was blocked, allow
						popups for this site and{" "}
						<button onClick={onSignIn} type="button">
							try again
						</button>
						. Hosted apps also need the Sign in with ChatGPT extension.
					</span>
				</div>
			) : null}

			{error ? (
				<div className="errorBanner" style={{ maxWidth: 460 }}>
					<WarningIcon className="icon sm" />
					<span>
						{error}{" "}
						<button onClick={onSignIn} type="button">
							Try again
						</button>
					</span>
				</div>
			) : null}
		</main>
	)
}
