const ansi = {
	dim: "\u001B[2m",
	reset: "\u001B[0m",
	underline: "\u001B[4m",
}

type CliWarning = {
	type: string
	feature?: string
	details?: string
	message?: string
}

const formatWarningMessage = (
	warning: CliWarning,
	provider: string,
	model: string,
): string => {
	const prefix = `openai-oauth Warning (${provider} / ${model}):`

	switch (warning.type) {
		case "unsupported": {
			let message = `${prefix} The feature "${warning.feature}" is not supported.`
			if (warning.details) {
				message += ` ${warning.details}`
			}
			return message
		}

		case "compatibility": {
			let message = `${prefix} The feature "${warning.feature}" is used in a compatibility mode.`
			if (warning.details) {
				message += ` ${warning.details}`
			}
			return message
		}

		case "other":
			return `${prefix} ${warning.message ?? "Unknown warning."}`

		default:
			return `${prefix} ${JSON.stringify(warning, null, 2)}`
	}
}

const withAnsi = (
	text: string,
	code: string,
	options?: { useColor?: boolean },
): string => {
	if (!options?.useColor) {
		return text
	}

	return `${code}${text}${ansi.reset}`
}

export const underline = (
	text: string,
	options?: { useColor?: boolean },
): string => withAnsi(text, ansi.underline, options)

export const dim = (text: string, options?: { useColor?: boolean }): string =>
	withAnsi(text, ansi.dim, options)

export const toStartupMessage = (
	baseUrl: string,
	availableModels: string[],
	options?: { useColor?: boolean },
): string =>
	[
		`OpenAI-compatible endpoint ready at ${underline(baseUrl, options)}`,
		dim("Use this as your OpenAI base URL. No API key is required.", options),
		"",
		`Available Models: ${availableModels.join(", ")}`,
	].join("\n")

const notRunning = "OpenAI OAuth is not running."

export const cliMessages = {
	foregroundControls: "[d] Run in background  [q] Quit",
	backgroundActions:
		"Stop with `npx openai-oauth stop` or see logs with `npx openai-oauth logs --follow`",
	notRunning,
	notRunningWithStart: [notRunning, "", "Start with `npx openai-oauth`"].join(
		"\n",
	),
	noLogs: "No OpenAI OAuth logs found.",
	followingLogs: "Following OpenAI OAuth logs. Press Ctrl+C to stop following.",
	stopped: "OpenAI OAuth stopped.",
	stoppedRemotely: "OpenAI OAuth was stopped from another terminal.",
	couldNotStop: "Could not stop OpenAI OAuth.",
	couldNotDetach: (details?: string): string => {
		if (details?.startsWith("Could not move OpenAI OAuth to the background")) {
			return details
		}
		return details
			? `Could not move OpenAI OAuth to the background: ${details}`
			: "Could not move OpenAI OAuth to the background."
	},
	stoppedUnexpectedly: (details: string): string =>
		`OpenAI OAuth stopped unexpectedly (${details}).`,
	workerStarted: (baseUrl: string): string =>
		`OpenAI OAuth started at ${baseUrl}`,
} as const

export const toForegroundStartupMessage = (
	baseUrl: string,
	availableModels: string[],
	options?: { useColor?: boolean },
): string =>
	[
		toStartupMessage(baseUrl, availableModels, options),
		"",
		dim(cliMessages.foregroundControls, options),
	].join("\n")

export const toBackgroundStartupMessage = (
	baseUrl: string,
	availableModels: string[],
	options?: { useColor?: boolean },
): string =>
	[
		toStartupMessage(baseUrl, availableModels, options),
		"",
		cliMessages.backgroundActions,
	].join("\n")

export const toDetachedMessage = (baseUrl: string): string =>
	[
		`OpenAI OAuth is now running in the background at ${baseUrl}`,
		"",
		cliMessages.backgroundActions,
	].join("\n")

export const toAlreadyRunningMessage = (baseUrl: string): string =>
	[
		`OpenAI OAuth is already running at ${baseUrl}`,
		"",
		cliMessages.backgroundActions,
	].join("\n")

export const toRunningMessage = (baseUrl: string): string =>
	[
		`OpenAI OAuth is running at ${baseUrl}`,
		"",
		cliMessages.backgroundActions,
	].join("\n")

export const installCliWarningLogger = (): void => {
	let hasLoggedWarningSystemMessage = false

	globalThis.AI_SDK_LOG_WARNINGS = ({ warnings, provider, model }) => {
		if (warnings.length === 0) {
			return
		}

		if (!hasLoggedWarningSystemMessage) {
			hasLoggedWarningSystemMessage = true
			console.info("")
			console.info(
				"openai-oauth Warning System: To turn off warning logging, set the AI_SDK_LOG_WARNINGS global to false.",
			)
		}

		for (const warning of warnings) {
			console.warn(formatWarningMessage(warning as CliWarning, provider, model))
		}
	}
}
