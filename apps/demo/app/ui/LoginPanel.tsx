"use client"

import { useCompletion } from "@ai-sdk/react"
import {
	openaiAuthHeaders,
	SignInWithChatGPT,
	type SignInWithChatGPTState,
} from "@openai-oauth/react"
import Image from "next/image"
import { type CSSProperties, useEffect, useRef, useState } from "react"

type DemoMode = "sign-in" | "local-api"
type RequestCodeTab = "app" | "route"
type RequestKind = "text" | "image"

const requestModel = "gpt-5.4-mini"
const maxResponseLines = 10

const initialAuthState: SignInWithChatGPTState = {
	status: "checking",
	session: null,
	error: null,
}

const signInCode = `"use client";

import { SignInWithChatGPT } from "@openai-oauth/react";

export default function App() {
  return <SignInWithChatGPT />;
}`

const requestCode = {
	app: `"use client";

import { useCompletion } from "@ai-sdk/react";
import { openaiAuthHeaders } from "@openai-oauth/react";

const { completion, complete } = useCompletion({
  api: "/api/chat",
  streamProtocol: "text",
});

await complete("Hello!", {
  headers: await openaiAuthHeaders(),
});`,
	route: `import { createOpenAIOAuth } from "@openai-oauth/ai-sdk";
import { openaiCredentials } from "@openai-oauth/react/server";
import { streamText } from "ai";

export async function POST(request: Request) {
  const { prompt } = await request.json();
  const openai = createOpenAIOAuth(openaiCredentials(request));

  const result = streamText({
    model: openai("gpt-5.4-mini"),
    prompt,
  });

  return result.toTextStreamResponse();
}`,
} satisfies Record<RequestCodeTab, string>

const imageCode = {
	app: `import { openaiAuthHeaders } from "@openai-oauth/react";

const response = await fetch("/api/image", {
  method: "POST",
  headers: {
    ...await openaiAuthHeaders(),
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ prompt: "A tiny house in a forest" }),
});

const image = await response.blob();`,
	route: `import { createOpenAIOAuth } from "@openai-oauth/ai-sdk";
import { openaiCredentials } from "@openai-oauth/react/server";
import { generateImage } from "ai";

export async function POST(request: Request) {
  const { prompt } = await request.json();
  const openai = createOpenAIOAuth(openaiCredentials(request));

  const result = await generateImage({
    model: openai.image("gpt-image-2"),
    prompt,
  });

  return new Response(Uint8Array.from(result.image.uint8Array), {
    headers: { "Content-Type": result.image.mediaType },
  });
}`,
} satisfies Record<RequestCodeTab, string>

const localApiCommand = `npx openai-oauth`

const requestCodeLineCount = Math.max(
	...Object.values(requestCode).map((code) => code.split("\n").length),
)
const imageCodeLineCount = Math.max(
	...Object.values(imageCode).map((code) => code.split("\n").length),
)
const requestDemoLineCount = Math.max(requestCodeLineCount, imageCodeLineCount)

function truncateResponse(text: string) {
	const lines = text.split(/\r?\n/)
	if (lines.length <= maxResponseLines) {
		return text
	}

	const visibleLines = lines.slice(0, maxResponseLines)
	const lastLine = visibleLines[maxResponseLines - 1]?.trimEnd() ?? ""
	visibleLines[maxResponseLines - 1] = `${lastLine}...`
	return visibleLines.join("\n")
}

const GitHubIcon = () => (
	<svg
		aria-hidden="true"
		fill="currentColor"
		focusable="false"
		viewBox="0 0 24 24"
	>
		<path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.14c-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.16 1.18A10.9 10.9 0 0 1 12 6.05c.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.23 2.75.11 3.04.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.42.36.78 1.06.78 2.14v3.15c0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
	</svg>
)

const CopyIcon = () => (
	<svg
		aria-hidden="true"
		fill="none"
		focusable="false"
		stroke="currentColor"
		strokeLinecap="round"
		strokeLinejoin="round"
		strokeWidth="2"
		viewBox="0 0 24 24"
	>
		<rect height="14" rx="2" width="14" x="8" y="8" />
		<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
	</svg>
)

const CheckIcon = () => (
	<svg
		aria-hidden="true"
		fill="none"
		focusable="false"
		stroke="currentColor"
		strokeLinecap="round"
		strokeLinejoin="round"
		strokeWidth="2.2"
		viewBox="0 0 24 24"
	>
		<path d="m20 6-11 11-5-5" />
	</svg>
)

const LockIcon = () => (
	<svg
		aria-hidden="true"
		fill="none"
		focusable="false"
		stroke="currentColor"
		strokeLinecap="round"
		strokeLinejoin="round"
		strokeWidth="2"
		viewBox="0 0 24 24"
	>
		<rect height="10" rx="2" width="14" x="5" y="11" />
		<path d="M8 11V7a4 4 0 0 1 8 0v4" />
	</svg>
)

const keywordTokens = new Set([
	"await",
	"const",
	"default",
	"export",
	"from",
	"function",
	"import",
	"return",
])

const tokenPattern =
	/(\/\/.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:await|const|default|export|from|function|import|return)\b|<\/?[A-Z][A-Za-z0-9]*|[A-Za-z_$][\w$]*(?=\())/g

function highlightedCode(code: string) {
	const nodes = []
	let index = 0
	let key = 0

	for (const match of code.matchAll(tokenPattern)) {
		const token = match[0]
		const start = match.index ?? 0

		if (start > index) {
			nodes.push(code.slice(index, start))
		}

		let className = "syntax-function"
		if (token.startsWith("//")) {
			className = "syntax-comment"
		} else if (
			token.startsWith('"') ||
			token.startsWith("'") ||
			token.startsWith("`")
		) {
			className = "syntax-string"
		} else if (keywordTokens.has(token)) {
			className = "syntax-keyword"
		} else if (token.startsWith("<")) {
			className = "syntax-component"
		}

		nodes.push(
			<span className={className} key={`token-${key}`}>
				{token}
			</span>,
		)
		index = start + token.length
		key += 1
	}

	if (index < code.length) {
		nodes.push(code.slice(index))
	}

	return nodes
}

const ArrowUpIcon = () => (
	<span aria-hidden="true" className="arrowUp">
		↑
	</span>
)

function CodeBlock({
	code,
	minLines,
	tabs,
	activeTab,
	onTabChange,
}: {
	code: string
	minLines?: number
	tabs?: Array<{ id: RequestCodeTab; label: string }>
	activeTab?: RequestCodeTab
	onTabChange?: (tab: RequestCodeTab) => void
}) {
	const [hasCopied, setHasCopied] = useState(false)

	const handleCopy = async () => {
		try {
			await navigator.clipboard?.writeText(code)
		} catch {
			// Clipboard permissions can be stricter in embedded browsers.
		}
		setHasCopied(true)
		window.setTimeout(() => setHasCopied(false), 1800)
	}

	return (
		<div
			className="codeFrame"
			style={
				minLines
					? ({ "--code-min-lines": minLines } as CSSProperties)
					: undefined
			}
		>
			{tabs ? (
				<div aria-label="Code file" className="codeTabs" role="tablist">
					{tabs.map((tab) => (
						<button
							aria-selected={activeTab === tab.id}
							className="codeTab"
							key={tab.id}
							onClick={() => onTabChange?.(tab.id)}
							role="tab"
							type="button"
						>
							{tab.label}
						</button>
					))}
				</div>
			) : null}
			<pre>
				<code>{highlightedCode(code)}</code>
			</pre>
			<button
				aria-label={hasCopied ? "Code copied" : "Copy code"}
				className="codeCopyButton"
				onClick={handleCopy}
				type="button"
			>
				{hasCopied ? <CheckIcon /> : <CopyIcon />}
			</button>
		</div>
	)
}

export function LoginPanel() {
	const [authState, setAuthState] =
		useState<SignInWithChatGPTState>(initialAuthState)
	const [prompt, setPrompt] = useState("")
	const [imagePrompt, setImagePrompt] = useState("")
	const [imageUrl, setImageUrl] = useState<string | null>(null)
	const [imageError, setImageError] = useState<string | null>(null)
	const [isGeneratingImage, setIsGeneratingImage] = useState(false)
	const [activeRequestTab, setActiveRequestTab] =
		useState<RequestCodeTab>("app")
	const [activeImageTab, setActiveImageTab] = useState<RequestCodeTab>("app")
	const [requestKind, setRequestKind] = useState<RequestKind>("text")
	const [isRequestMenuOpen, setIsRequestMenuOpen] = useState(false)
	const requestMenuRef = useRef<HTMLDivElement>(null)
	const [activeMode, setActiveMode] = useState<DemoMode>("sign-in")
	const [hasCopiedLocalCommand, setHasCopiedLocalCommand] = useState(false)
	const {
		complete,
		completion,
		error: completionError,
		isLoading,
		setCompletion,
	} = useCompletion({
		api: "/api/chat",
		streamProtocol: "text",
	})

	const isSignedIn = authState.status === "signed-in"
	const isRequesting = isLoading
	const canRequest = isSignedIn && !isRequesting && prompt.trim().length > 0
	const canGenerateImage =
		isSignedIn && !isGeneratingImage && imagePrompt.trim().length > 0

	useEffect(() => {
		return () => {
			if (imageUrl) {
				URL.revokeObjectURL(imageUrl)
			}
		}
	}, [imageUrl])

	useEffect(() => {
		if (!isRequestMenuOpen) {
			return
		}

		const closeOnOutsideClick = (event: MouseEvent) => {
			if (!requestMenuRef.current?.contains(event.target as Node)) {
				setIsRequestMenuOpen(false)
			}
		}
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsRequestMenuOpen(false)
			}
		}

		document.addEventListener("pointerdown", closeOnOutsideClick)
		document.addEventListener("keydown", closeOnEscape)
		return () => {
			document.removeEventListener("pointerdown", closeOnOutsideClick)
			document.removeEventListener("keydown", closeOnEscape)
		}
	}, [isRequestMenuOpen])

	const handleAuthStateChange = (next: SignInWithChatGPTState) => {
		setAuthState(next)
		if (next.status !== "signed-in") {
			setCompletion("")
			setImageUrl(null)
			setImageError(null)
			setRequestKind("text")
			setIsRequestMenuOpen(false)
		}
	}

	const handleGenerateImage = async () => {
		const input = imagePrompt.trim()
		if (!input || isGeneratingImage) {
			return
		}

		setIsGeneratingImage(true)
		setImageError(null)

		try {
			const response = await fetch("/api/image", {
				method: "POST",
				headers: {
					...(await openaiAuthHeaders()),
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ prompt: input }),
			})

			if (!response.ok) {
				throw new Error((await response.text()) || "Image generation failed.")
			}

			setImageUrl(URL.createObjectURL(await response.blob()))
		} catch (error) {
			setImageError(
				error instanceof Error ? error.message : "Image generation failed.",
			)
		} finally {
			setIsGeneratingImage(false)
		}
	}

	const handleMakeRequest = async () => {
		const input = prompt.trim()
		if (!input || isRequesting) {
			return
		}

		try {
			await complete(input, {
				headers: await openaiAuthHeaders(),
			})
		} catch (error) {
			console.error(error)
		}
	}

	const handleCopyLocalCommand = async () => {
		try {
			await navigator.clipboard?.writeText(localApiCommand)
		} catch {
			// Clipboard permissions can be stricter in embedded browsers.
		}
		setHasCopiedLocalCommand(true)
		window.setTimeout(() => setHasCopiedLocalCommand(false), 1800)
	}

	return (
		<main className="demoShell">
			<header className="siteHeader">
				<a aria-label="OpenAI OAuth" className="wordmark" href="/">
					<Image
						alt=""
						height={28}
						priority
						src="/openai-oauth-wordmark.svg"
						width={202}
					/>
				</a>
				<nav aria-label="Demo modes" className="modeTabs">
					<button
						aria-current={activeMode === "sign-in" ? "page" : undefined}
						onClick={() => setActiveMode("sign-in")}
						type="button"
					>
						Sign in with ChatGPT
					</button>
					<button
						aria-current={activeMode === "local-api" ? "page" : undefined}
						onClick={() => setActiveMode("local-api")}
						type="button"
					>
						Free OpenAI API
					</button>
				</nav>
				<a
					aria-label="GitHub"
					className="githubLink"
					href="https://github.com/EvanZhouDev/openai-oauth"
					rel="noreferrer"
					target="_blank"
				>
					<GitHubIcon />
				</a>
			</header>

			{activeMode === "sign-in" ? (
				<section
					aria-label="Sign in with ChatGPT demo"
					className="demoPanel signInPanel"
				>
					<div className="stepRow">
						<section className="stepDocs">
							<div className="stepHeading">
								<span className="stepNumber">1</span>
								<div>
									<h1>Add sign in</h1>
									<p>Let users connect their ChatGPT account.</p>
								</div>
							</div>
							<CodeBlock code={signInCode} />
						</section>

						<section className="stepOutput signInOutput">
							<h2 className="outputHeading">Try it out</h2>
							<p className="planNote">Works across free and paid plans.</p>
							<SignInWithChatGPT
								hideAttribution
								onStateChange={handleAuthStateChange}
								style={{
									fontSize: 16,
									minHeight: 58,
									minWidth: 274,
									padding: "16px 24px",
								}}
							/>
							<p className="safetyNote">
								<LockIcon />
								<span>
									Credentials are encrypted and
									<br />
									stored locally in this browser.
								</span>
							</p>
							{authState.status === "error" ? (
								<p className="errorText" role="alert">
									{authState.error.message}
								</p>
							) : null}
						</section>
					</div>

					<div className={`stepRow ${isSignedIn ? "" : "locked"}`}>
						<section className="stepDocs">
							<div className="stepHeading">
								<span className="stepNumber">2</span>
								<div>
									<div className="requestTypeControl" ref={requestMenuRef}>
										<button
											aria-expanded={isRequestMenuOpen}
											aria-haspopup="menu"
											className="requestTypeButton"
											onClick={() => setIsRequestMenuOpen((open) => !open)}
											type="button"
										>
											{requestKind === "image"
												? "Generate an image"
												: "Make a request"}
											<span aria-hidden="true" className="chevronDown" />
										</button>
										{isRequestMenuOpen ? (
											<div className="requestTypeMenu" role="menu">
												<button
													aria-checked={requestKind === "text"}
													onClick={() => {
														setRequestKind("text")
														setIsRequestMenuOpen(false)
													}}
													role="menuitemradio"
													type="button"
												>
													Make a request
												</button>
												{isSignedIn ? (
													<button
														aria-checked={requestKind === "image"}
														onClick={() => {
															setRequestKind("image")
															setIsRequestMenuOpen(false)
														}}
														role="menuitemradio"
														type="button"
													>
														Generate an image
													</button>
												) : null}
											</div>
										) : null}
									</div>
									<p>
										{requestKind === "image"
											? "Create images with the signed-in account. Only available on paid accounts."
											: "Use the AI SDK with the signed-in account."}
									</p>
								</div>
							</div>
							{requestKind === "image" ? (
								<CodeBlock
									activeTab={activeImageTab}
									code={imageCode[activeImageTab]}
									minLines={requestDemoLineCount}
									onTabChange={setActiveImageTab}
									tabs={[
										{ id: "app", label: "app.tsx" },
										{ id: "route", label: "app/api/image/route.ts" },
									]}
								/>
							) : (
								<CodeBlock
									activeTab={activeRequestTab}
									code={requestCode[activeRequestTab]}
									minLines={requestDemoLineCount}
									onTabChange={setActiveRequestTab}
									tabs={[
										{ id: "app", label: "app.tsx" },
										{ id: "route", label: "app/api/chat/route.ts" },
									]}
								/>
							)}
						</section>

						<section
							className={`stepOutput ${requestKind === "image" ? "imageOutput" : "requestOutput"}`}
						>
							{requestKind === "image" ? (
								<>
									<form
										className="askForm"
										onSubmit={(event) => {
											event.preventDefault()
											void handleGenerateImage()
										}}
									>
										<label className="srOnly" htmlFor="image-prompt">
											Describe an image
										</label>
										<input
											disabled={!isSignedIn}
											id="image-prompt"
											onChange={(event) => setImagePrompt(event.target.value)}
											placeholder="Describe an image"
											value={imagePrompt}
										/>
										<button
											aria-label="Generate image"
											disabled={!canGenerateImage}
											type="submit"
										>
											<ArrowUpIcon />
										</button>
									</form>

									{isGeneratingImage ? (
										<p className="statusText">Generating with gpt-image-2...</p>
									) : null}

									{imageUrl ? (
										<div className="generatedImage">
											<Image
												alt={imagePrompt || "Generated image"}
												fill
												sizes="(max-width: 760px) 100vw, 420px"
												src={imageUrl}
												unoptimized
											/>
										</div>
									) : null}

									{imageError ? (
										<p className="errorText" role="alert">
											{imageError}
										</p>
									) : null}
								</>
							) : (
								<>
									<form
										className="askForm"
										onSubmit={(event) => {
											event.preventDefault()
											void handleMakeRequest()
										}}
									>
										<label className="srOnly" htmlFor="prompt">
											Ask anything
										</label>
										<input
											disabled={!isSignedIn}
											id="prompt"
											onChange={(event) => setPrompt(event.target.value)}
											placeholder="Ask anything"
											value={prompt}
										/>
										<button
											aria-label="Send"
											disabled={!canRequest}
											type="submit"
										>
											<ArrowUpIcon />
										</button>
									</form>

									{isRequesting ? (
										<p className="statusText">Asking {requestModel}...</p>
									) : null}

									{completion ? (
										<output className="responseText">
											{truncateResponse(completion)}
										</output>
									) : null}

									{completionError ? (
										<p className="errorText" role="alert">
											{completionError.message}
										</p>
									) : null}
								</>
							)}
						</section>
					</div>
				</section>
			) : (
				<section
					aria-label="Free OpenAI API demo"
					className="demoPanel localApiPanel"
				>
					<div className="localApiContent">
						<h1>
							Free AI API with your <br />
							ChatGPT Account
						</h1>
						<p>Run in your terminal to get started today.</p>
						<div className="localCommand">
							<code>{localApiCommand}</code>
							<button
								aria-label={
									hasCopiedLocalCommand ? "Command copied" : "Copy command"
								}
								onClick={handleCopyLocalCommand}
								type="button"
							>
								{hasCopiedLocalCommand ? <CheckIcon /> : <CopyIcon />}
							</button>
						</div>
					</div>
				</section>
			)}

			<section className="docsCta">
				<h2>Build with OpenAI OAuth</h2>
				<p>
					Add Sign in with ChatGPT to your product, start a <br />
					dev proxy, or connect through the TypeScript SDK.
				</p>
				<a
					className="docsButton"
					href="https://github.com/EvanZhouDev/openai-oauth#readme"
					rel="noreferrer"
					target="_blank"
				>
					Go to Documentation
				</a>
			</section>
		</main>
	)
}
