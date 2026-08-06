"use client"

import {
	BrandIcon,
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

export function SignIn({
	status,
	error,
	onSignIn,
}: {
	status: string
	error?: string
	onSignIn: () => void
}) {
	const busy =
		status === "checking" || status === "starting" || status === "redirecting"

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

			{error ? (
				<span className="signInNote" style={{ color: "var(--danger)" }}>
					<WarningIcon className="icon xs" />
					{error}
				</span>
			) : null}
		</main>
	)
}
