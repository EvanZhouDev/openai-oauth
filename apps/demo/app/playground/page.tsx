import type { Metadata } from "next"
import { Playground } from "./ui/Playground"
import "./playground.css"

export const metadata: Metadata = {
	title: "OpenAI OAuth Playground",
	description:
		"End-to-end chat playground for OpenAI OAuth: /v1/models, /v1/responses, /v1/chat/completions, streaming, tool calls, and reasoning traces.",
	openGraph: {
		title: "OpenAI OAuth Playground",
		description:
			"End-to-end chat playground for OpenAI OAuth: /v1/models, /v1/responses, /v1/chat/completions, streaming, tool calls, and reasoning traces.",
		url: "/playground",
	},
}

export default function Page() {
	return <Playground />
}
