import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"
import "./globals.css"

export const metadata: Metadata = {
	title: "Agent — build with your ChatGPT account",
	description:
		"A ChatGPT-style coding agent with a sandbox terminal, file tools and web search, powered by your own ChatGPT account.",
	icons: {
		icon: [{ sizes: "32x32", type: "image/png", url: "/favicon-32x32.png" }],
		apple: "/apple-touch-icon.png",
		shortcut: "/favicon-32x32.png",
	},
}

export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#ffffff" },
		{ media: "(prefers-color-scheme: dark)", color: "#212121" },
	],
	initialScale: 1,
	maximumScale: 1,
	viewportFit: "cover",
	width: "device-width",
}

// Applies the saved theme before first paint so the app never flashes white.
const themeScript = `(() => {
	try {
		const stored = localStorage.getItem("agent.theme")
		const theme = stored === "light" || stored === "dark"
			? stored
			: (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
		document.documentElement.dataset.theme = theme
	} catch {}
})()`

export default function RootLayout({
	children,
}: Readonly<{ children: ReactNode }>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: static inline theme bootstrap */}
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
			</head>
			<body>{children}</body>
		</html>
	)
}
