export type PlaygroundTool = {
	name: string
	description: string
	parameters: Record<string, unknown>
	execute: (args: Record<string, unknown>) => unknown
}

const asString = (value: unknown, fallback = ""): string =>
	typeof value === "string" ? value : fallback

/**
 * Tokenizer + recursive descent parser for the `calculate` tool. Deliberately
 * not `eval`: tool arguments are model output and must never be executed.
 */
const evaluateExpression = (expression: string): number => {
	const tokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/%^]/g)
	if (!tokens || tokens.join("") !== expression.replaceAll(/\s+/g, "")) {
		throw new Error(
			"Only numbers, parentheses and + - * / % ^ operators are supported.",
		)
	}

	let position = 0
	const peek = (): string | undefined => tokens[position]
	const consume = (): string => {
		const token = tokens[position]
		if (token === undefined) {
			throw new Error("Unexpected end of expression.")
		}
		position += 1
		return token
	}

	const parseExpression = (): number => {
		let value = parseTerm()
		while (peek() === "+" || peek() === "-") {
			value = consume() === "+" ? value + parseTerm() : value - parseTerm()
		}
		return value
	}

	const parseTerm = (): number => {
		let value = parsePower()
		while (peek() === "*" || peek() === "/" || peek() === "%") {
			const operator = consume()
			const right = parsePower()
			if ((operator === "/" || operator === "%") && right === 0) {
				throw new Error("Division by zero.")
			}
			value =
				operator === "*"
					? value * right
					: operator === "/"
						? value / right
						: value % right
		}
		return value
	}

	const parsePower = (): number => {
		const base = parseUnary()
		if (peek() !== "^") {
			return base
		}
		consume()
		// Right associative: 2^3^2 is 2^9.
		return base ** parsePower()
	}

	const parseUnary = (): number => {
		if (peek() === "-") {
			consume()
			return -parseUnary()
		}
		if (peek() === "+") {
			consume()
			return parseUnary()
		}
		return parsePrimary()
	}

	const parsePrimary = (): number => {
		const token = consume()
		if (token === "(") {
			const value = parseExpression()
			if (consume() !== ")") {
				throw new Error("Unbalanced parentheses.")
			}
			return value
		}

		const value = Number(token)
		if (Number.isNaN(value)) {
			throw new Error(`Unexpected token "${token}".`)
		}
		return value
	}

	const result = parseExpression()
	if (position !== tokens.length) {
		throw new Error("Unexpected trailing input.")
	}
	if (!Number.isFinite(result)) {
		throw new Error("Result is not a finite number.")
	}
	return result
}

const hashString = (value: string): number => {
	let hash = 0
	for (const character of value) {
		hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 100_000
	}
	return hash
}

const conditions = [
	"clear",
	"partly cloudy",
	"overcast",
	"light rain",
	"thunderstorms",
	"snow",
	"windy",
]

export const playgroundTools: PlaygroundTool[] = [
	{
		name: "get_weather",
		description:
			"Get the current weather for a city. Returns sample data from the demo, not a real forecast.",
		parameters: {
			type: "object",
			properties: {
				city: { type: "string", description: "City name, e.g. 'Tokyo'." },
				unit: {
					type: "string",
					enum: ["celsius", "fahrenheit"],
					description: "Temperature unit. Defaults to celsius.",
				},
			},
			required: ["city"],
			additionalProperties: false,
		},
		execute: (args) => {
			const city = asString(args.city).trim()
			if (!city) {
				throw new Error("`city` is required.")
			}

			const seed = hashString(city.toLowerCase())
			const celsius = (seed % 43) - 8
			const unit = args.unit === "fahrenheit" ? "fahrenheit" : "celsius"

			return {
				city,
				unit,
				temperature:
					unit === "fahrenheit" ? Math.round((celsius * 9) / 5 + 32) : celsius,
				condition: conditions[seed % conditions.length],
				humidity: `${30 + (seed % 60)}%`,
				source: "openai-oauth playground sample data",
			}
		},
	},
	{
		name: "calculate",
		description:
			"Evaluate an arithmetic expression. Supports + - * / % ^ and parentheses.",
		parameters: {
			type: "object",
			properties: {
				expression: {
					type: "string",
					description: "The expression to evaluate, e.g. '(19 * 4) / 7'.",
				},
			},
			required: ["expression"],
			additionalProperties: false,
		},
		execute: (args) => {
			const expression = asString(args.expression).trim()
			if (!expression) {
				throw new Error("`expression` is required.")
			}
			return { expression, result: evaluateExpression(expression) }
		},
	},
	{
		name: "get_current_time",
		description:
			"Get the current date and time, optionally in a specific IANA timezone.",
		parameters: {
			type: "object",
			properties: {
				timezone: {
					type: "string",
					description:
						"IANA timezone, e.g. 'Europe/Berlin'. Defaults to local.",
				},
			},
			additionalProperties: false,
		},
		execute: (args) => {
			const timezone = asString(args.timezone).trim() || undefined
			const now = new Date()

			try {
				return {
					iso: now.toISOString(),
					timezone:
						timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
					formatted: new Intl.DateTimeFormat("en-US", {
						dateStyle: "full",
						timeStyle: "long",
						timeZone: timezone,
					}).format(now),
				}
			} catch {
				throw new Error(`Unknown timezone "${timezone}".`)
			}
		},
	},
]

export const toolByName = new Map(
	playgroundTools.map((entry) => [entry.name, entry]),
)

export const runTool = (
	name: string,
	rawArguments: string,
): { output: string; error?: string } => {
	const entry = toolByName.get(name)
	if (!entry) {
		return {
			output: JSON.stringify({ error: `Unknown tool "${name}".` }),
			error: `Unknown tool "${name}".`,
		}
	}

	let parsed: unknown
	try {
		parsed = rawArguments.trim().length === 0 ? {} : JSON.parse(rawArguments)
	} catch {
		return {
			output: JSON.stringify({ error: "Tool arguments were not valid JSON." }),
			error: "Tool arguments were not valid JSON.",
		}
	}

	try {
		const result = entry.execute(
			(typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<
				string,
				unknown
			>,
		)
		return { output: JSON.stringify(result) }
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Tool execution failed."
		// The error is returned to the model as the tool output so it can
		// recover, and surfaced in the UI as a failed call.
		return { output: JSON.stringify({ error: message }), error: message }
	}
}
