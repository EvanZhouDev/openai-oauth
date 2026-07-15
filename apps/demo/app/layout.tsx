import type { Metadata } from "next"
import type { ReactNode } from "react"
import "./styles.css"

const siteUrl =
	process.env.NEXT_PUBLIC_SITE_URL ??
	(process.env.VERCEL_PROJECT_PRODUCTION_URL
		? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
		: process.env.VERCEL_URL
			? `https://${process.env.VERCEL_URL}`
			: "http://localhost:3000")

export const metadata: Metadata = {
	metadataBase: new URL(siteUrl),
	title: "OpenAI OAuth",
	description: "Free OpenAI API access with your ChatGPT account.",
	icons: {
		icon: [
			{
				sizes: "32x32",
				type: "image/png",
				url: "/favicon-32x32.png",
			},
		],
		apple: "/apple-touch-icon.png",
		shortcut: "/favicon-32x32.png",
	},
	openGraph: {
		description: "Free OpenAI API access with your ChatGPT account.",
		images: [
			{
				alt: "OpenAI OAuth",
				height: 640,
				url: "/opengraph-image.png",
				width: 1280,
			},
		],
		siteName: "OpenAI OAuth",
		title: "OpenAI OAuth",
		type: "website",
		url: "/",
	},
	twitter: {
		card: "summary_large_image",
		description: "Free OpenAI API access with your ChatGPT account.",
		images: ["/opengraph-image.png"],
		title: "OpenAI OAuth",
	},
}

export default function RootLayout({
	children,
}: Readonly<{
	children: ReactNode
}>) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	)
}
