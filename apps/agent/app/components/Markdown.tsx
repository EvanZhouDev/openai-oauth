"use client"

import { Fragment, type ReactNode, useState } from "react"
import { CheckIcon, CopyIcon } from "./icons"

/* ---------------------------------------------------------------------------
   Syntax highlighting — small, dependency free, good enough for chat.
--------------------------------------------------------------------------- */

const KEYWORDS = new Set([
	"abstract",
	"as",
	"async",
	"await",
	"bool",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"def",
	"default",
	"del",
	"delete",
	"do",
	"elif",
	"else",
	"enum",
	"export",
	"extends",
	"False",
	"false",
	"finally",
	"float",
	"fn",
	"for",
	"from",
	"func",
	"function",
	"go",
	"if",
	"impl",
	"implements",
	"import",
	"in",
	"instanceof",
	"int",
	"interface",
	"is",
	"let",
	"match",
	"mod",
	"mut",
	"new",
	"nil",
	"None",
	"not",
	"null",
	"or",
	"package",
	"pass",
	"print",
	"private",
	"protected",
	"public",
	"pub",
	"raise",
	"readonly",
	"return",
	"select",
	"self",
	"static",
	"str",
	"struct",
	"super",
	"switch",
	"this",
	"throw",
	"True",
	"true",
	"try",
	"type",
	"typeof",
	"undefined",
	"union",
	"unless",
	"use",
	"using",
	"var",
	"void",
	"when",
	"while",
	"with",
	"yield",
])

const TOKEN_PATTERN = new RegExp(
	[
		"(#[^\\n]*|//[^\\n]*|--[^\\n]*|/\\*[\\s\\S]*?\\*/)",
		"(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|`(?:\\\\.|[^`\\\\])*`)",
		"\\b(0x[0-9a-fA-F]+|\\d+\\.?\\d*)\\b",
		"\\b([A-Za-z_$][\\w$]*)(?=\\s*\\()",
		"\\b([A-Z][A-Za-z0-9_]*)\\b",
		"\\b([A-Za-z_$][\\w$]*)\\b",
	].join("|"),
	"g",
)

const highlight = (code: string, language: string): ReactNode[] => {
	if (language === "text" || language === "" || code.length > 40_000) {
		return [code]
	}

	const nodes: ReactNode[] = []
	let cursor = 0
	let key = 0

	for (const match of code.matchAll(TOKEN_PATTERN)) {
		const [token, comment, string, number, fn, type, word] = match
		const start = match.index ?? 0
		if (start > cursor) {
			nodes.push(code.slice(cursor, start))
		}

		let className: string | undefined
		if (comment) {
			className = "tok-comment"
		} else if (string) {
			className = "tok-string"
		} else if (number) {
			className = "tok-number"
		} else if (fn) {
			className = KEYWORDS.has(fn) ? "tok-keyword" : "tok-function"
		} else if (type) {
			className = "tok-type"
		} else if (word && KEYWORDS.has(word)) {
			className = "tok-keyword"
		}

		if (className) {
			nodes.push(
				<span className={className} key={`t${key}`}>
					{token}
				</span>,
			)
			key += 1
		} else {
			nodes.push(token)
		}
		cursor = start + token.length
	}

	if (cursor < code.length) {
		nodes.push(code.slice(cursor))
	}
	return nodes
}

export function CodeBlock({
	code,
	language,
}: {
	code: string
	language: string
}) {
	const [copied, setCopied] = useState(false)

	const copy = async () => {
		try {
			await navigator.clipboard?.writeText(code)
			setCopied(true)
			window.setTimeout(() => setCopied(false), 1600)
		} catch {
			// Clipboard access can be blocked; nothing else to do.
		}
	}

	return (
		<div className="codeBlock">
			<div className="codeBlockHeader">
				<span>{language || "code"}</span>
				<button className="codeBlockCopy" onClick={copy} type="button">
					{copied ? (
						<CheckIcon className="icon xs" />
					) : (
						<CopyIcon className="icon xs" />
					)}
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
			<pre>
				<code>{highlight(code, language)}</code>
			</pre>
		</div>
	)
}

/* ---------------------------------------------------------------------------
   Inline formatting
--------------------------------------------------------------------------- */

const INLINE_PATTERN =
	/(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(~~[^~\n]+~~)|(\[[^\]\n]*\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+)/g

const renderInline = (text: string, keyPrefix: string): ReactNode[] => {
	const nodes: ReactNode[] = []
	let cursor = 0
	let key = 0

	for (const match of text.matchAll(INLINE_PATTERN)) {
		const token = match[0]
		const start = match.index ?? 0
		if (start > cursor) {
			nodes.push(text.slice(cursor, start))
		}
		const id = `${keyPrefix}-i${key}`
		key += 1

		if (token.startsWith("`")) {
			nodes.push(<code key={id}>{token.slice(1, -1)}</code>)
		} else if (token.startsWith("**") || token.startsWith("__")) {
			nodes.push(<strong key={id}>{token.slice(2, -2)}</strong>)
		} else if (token.startsWith("~~")) {
			nodes.push(<del key={id}>{token.slice(2, -2)}</del>)
		} else if (token.startsWith("*")) {
			nodes.push(<em key={id}>{token.slice(1, -1)}</em>)
		} else if (token.startsWith("[")) {
			const label = token.slice(1, token.indexOf("]"))
			const href = token.slice(token.indexOf("](") + 2, -1)
			nodes.push(
				<a href={href} key={id} rel="noreferrer noopener" target="_blank">
					{label || href}
				</a>,
			)
		} else {
			nodes.push(
				<a href={token} key={id} rel="noreferrer noopener" target="_blank">
					{token}
				</a>,
			)
		}
		cursor = start + token.length
	}

	if (cursor < text.length) {
		nodes.push(text.slice(cursor))
	}
	return nodes
}

/* ---------------------------------------------------------------------------
   Block parsing
--------------------------------------------------------------------------- */

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const HEADING = /^(#{1,6})\s+(.*)$/
const TABLE_DIVIDER = /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/

const splitRow = (line: string): string[] =>
	line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim())

export function Markdown({ content }: { content: string }) {
	const lines = content.split("\n")
	const blocks: ReactNode[] = []
	let index = 0
	let key = 0

	const nextKey = () => {
		key += 1
		return `b${key}`
	}

	const at = (position: number): string => lines[position] ?? ""

	while (index < lines.length) {
		const line = at(index)

		// Fenced code — an unterminated fence still renders while streaming.
		const fence = line.match(/^\s*```+\s*([\w+#-]*)\s*$/)
		if (fence) {
			const language = fence[1] ?? ""
			const body: string[] = []
			index += 1
			while (index < lines.length && !/^\s*```+\s*$/.test(at(index))) {
				body.push(at(index))
				index += 1
			}
			index += 1
			blocks.push(
				<CodeBlock
					code={body.join("\n")}
					key={nextKey()}
					language={language}
				/>,
			)
			continue
		}

		if (line.trim().length === 0) {
			index += 1
			continue
		}

		const heading = line.match(HEADING)
		if (heading) {
			const level = Math.min((heading[1] ?? "#").length, 4)
			const text = renderInline(heading[2] ?? "", `h${key}`)
			const id = nextKey()
			blocks.push(
				level === 1 ? (
					<h1 key={id}>{text}</h1>
				) : level === 2 ? (
					<h2 key={id}>{text}</h2>
				) : level === 3 ? (
					<h3 key={id}>{text}</h3>
				) : (
					<h4 key={id}>{text}</h4>
				),
			)
			index += 1
			continue
		}

		if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
			blocks.push(<hr key={nextKey()} />)
			index += 1
			continue
		}

		if (/^\s*>\s?/.test(line)) {
			const quoted: string[] = []
			while (index < lines.length && /^\s*>\s?/.test(at(index))) {
				quoted.push(at(index).replace(/^\s*>\s?/, ""))
				index += 1
			}
			blocks.push(
				<blockquote key={nextKey()}>
					<Markdown content={quoted.join("\n")} />
				</blockquote>,
			)
			continue
		}

		// Tables
		if (
			line.includes("|") &&
			index + 1 < lines.length &&
			TABLE_DIVIDER.test(at(index + 1))
		) {
			const header = splitRow(line)
			index += 2
			const rows: string[][] = []
			while (index < lines.length && at(index).includes("|")) {
				rows.push(splitRow(at(index)))
				index += 1
			}
			blocks.push(
				<table key={nextKey()}>
					<thead>
						<tr>
							{header.map((cell, cellIndex) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: header cells are positional
								<th key={`th-${cell}-${cellIndex}`}>
									{renderInline(cell, `th${cellIndex}`)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row, rowIndex) => (
							<tr key={`tr-${rowIndex}-${row[0] ?? ""}`}>
								{row.map((cell, cellIndex) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
									<td key={`td-${rowIndex}-${cellIndex}`}>
										{renderInline(cell, `td${rowIndex}${cellIndex}`)}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>,
			)
			continue
		}

		const listMatch = line.match(LIST_ITEM)
		if (listMatch) {
			const ordered = /\d/.test(listMatch[2] ?? "")
			const items: string[] = []
			while (index < lines.length) {
				const itemMatch = at(index).match(LIST_ITEM)
				if (!itemMatch) {
					// Continuation lines belong to the previous item.
					if (/^\s+\S/.test(at(index)) && items.length > 0) {
						items[items.length - 1] += `\n${at(index).trim()}`
						index += 1
						continue
					}
					break
				}
				if (/\d/.test(itemMatch[2] ?? "") !== ordered) {
					break
				}
				items.push(itemMatch[3] ?? "")
				index += 1
			}

			const rendered = items.map((item, itemIndex) => (
				<li key={`li-${itemIndex}-${item.slice(0, 12)}`}>
					{renderInline(item, `li${key}${itemIndex}`)}
				</li>
			))
			blocks.push(
				ordered ? (
					<ol key={nextKey()}>{rendered}</ol>
				) : (
					<ul key={nextKey()}>{rendered}</ul>
				),
			)
			continue
		}

		// Paragraph
		const paragraph: string[] = []
		while (
			index < lines.length &&
			at(index).trim().length > 0 &&
			!LIST_ITEM.test(at(index)) &&
			!HEADING.test(at(index)) &&
			!/^\s*```/.test(at(index)) &&
			!/^\s*>/.test(at(index))
		) {
			paragraph.push(at(index))
			index += 1
		}
		blocks.push(
			<p key={nextKey()}>{renderInline(paragraph.join("\n"), `p${key}`)}</p>,
		)
	}

	return (
		<div className="md">
			{blocks.map((block, blockIndex) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional by nature
				<Fragment key={`block-${blockIndex}`}>{block}</Fragment>
			))}
		</div>
	)
}
