import { access } from "node:fs/promises"
import { createInterface } from "node:readline/promises"
import {
	createCodexOAuthClient,
	resolveAuthFileCandidates,
	resolveCodexAuthFilePath,
} from "@openai-oauth/core"
import { openaiCredentials } from "@openai-oauth/local"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { installCliWarningLogger, toStartupMessage } from "./cli-logging.js"
import { startOpenAIOAuthServer } from "./index.js"
import { runOpenAIOAuthLogin } from "./login.js"
import { resolveOpenAIOAuthModels } from "./models.js"
import { DEFAULT_PORT } from "./shared.js"
import { checkForOpenAIOAuthUpdates } from "./update-check.js"
import { packageVersion } from "./version.js"

export type CliArgs = {
	command: "serve" | "login"
	host?: string
	port?: number
	models?: string[]
	codexVersion?: string
	baseURL?: string
	clientId?: string
	tokenUrl?: string
	authFilePath?: string
	openBrowser?: boolean
	loginTimeoutMs?: number
}

type LoginCancellation = {
	signal: AbortSignal
	exitCode: () => number
	dispose: () => void
}

const defaultUpdateCheckWarning = (message: string) => {
	console.error(message)
}

const parseModels = (value: string | undefined): string[] | undefined => {
	if (typeof value !== "string") {
		return undefined
	}

	const models = value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)

	return models.length > 0 ? models : undefined
}

const helpLines = [
	"Free OpenAI API access with your ChatGPT account.",
	"",
	"Usage",
	"  npx openai-oauth@latest [options]",
	"  npx openai-oauth@latest login [options]",
	"",
	"Options",
	"  --host <host>              Proxy host. Login callback always listens on loopback.",
	"  --port <port>              Proxy port. Default: 10531.",
	"  --models <ids>             Comma-separated model ids to expose from /v1/models.",
	"  --codex-version <version>  Codex API version to use for model discovery.",
	"  --base-url <url>           Override the upstream Codex base URL.",
	"  --oauth-client-id <id>     Override the OAuth client id used for refresh.",
	"  --oauth-token-url <url>    Override the OAuth token URL used for refresh.",
	"  --oauth-file <path>        Path to the local auth.json file.",
	"  --no-open                  Print the login URL without opening a browser.",
	"  --login-timeout-ms <ms>    Login timeout. Default: 300000",
	"",
	"Flags",
	"  --help                     Show help",
	`  --version                  Show version (${packageVersion})`,
	"",
	"Notes",
	"  If no auth file is found, run: npx openai-oauth login",
	"  By default, available models are discovered from your account.",
]

const createCliParser = (argv: string[]) =>
	yargs(argv)
		.scriptName("openai-oauth")
		.strict()
		.help(false)
		.version(false)
		.option("host", {
			type: "string",
			describe: "Proxy host. Login callback always listens on loopback.",
		})
		.option("port", {
			type: "number",
			describe: "Proxy port. Default: 10531.",
		})
		.option("models", {
			type: "string",
			describe: "Comma-separated model ids to expose from /v1/models.",
			coerce: parseModels,
		})
		.option("codex-version", {
			type: "string",
			describe: "Codex API version to use for model discovery.",
		})
		.option("base-url", {
			type: "string",
			describe: "Override the upstream Codex base URL.",
		})
		.option("oauth-client-id", {
			type: "string",
			describe: "Override the OAuth client id used for refresh.",
		})
		.option("oauth-token-url", {
			type: "string",
			describe: "Override the OAuth token URL used for refresh.",
		})
		.option("oauth-file", {
			type: "string",
			describe: "Path to the local auth.json file.",
		})
		.option("open", {
			type: "boolean",
			default: true,
			describe: "Open the login URL in a browser.",
		})
		.option("login-timeout-ms", {
			type: "number",
			describe: "Login timeout in milliseconds. Default: 300000",
		})

const isHelpFlag = (argv: string[]): boolean =>
	argv.includes("--help") || argv.includes("-h")

const isVersionFlag = (argv: string[]): boolean => argv.includes("--version")

export const toHelpMessage = (): string => helpLines.join("\n")

export const parseCliArgs = (argv: string[]): CliArgs => {
	const command = argv[0] === "login" ? "login" : "serve"
	const parsed = createCliParser(
		command === "login" ? argv.slice(1) : argv,
	).parseSync()

	return {
		command,
		host: parsed.host,
		port: parsed.port,
		models: parsed.models,
		codexVersion: parsed.codexVersion,
		baseURL: parsed.baseUrl,
		clientId: parsed.oauthClientId,
		tokenUrl: parsed.oauthTokenUrl,
		authFilePath: parsed.oauthFile,
		openBrowser: parsed.open,
		loginTimeoutMs: parsed.loginTimeoutMs,
	}
}

export const toServerOptions = (args: CliArgs) => ({
	host: args.host,
	port: args.port ?? DEFAULT_PORT,
	models: args.models,
	codexVersion: args.codexVersion,
	baseURL: args.baseURL,
	clientId: args.clientId,
	tokenUrl: args.tokenUrl,
	authFilePath: args.authFilePath,
})

export const toLoginOptions = (args: CliArgs) => ({
	clientId: args.clientId,
	tokenUrl: args.tokenUrl,
	authFilePath: args.authFilePath,
	openBrowser: args.openBrowser,
	timeoutMs: args.loginTimeoutMs,
})

const findExistingAuthFile = async (
	authFilePath: string | undefined,
): Promise<string | undefined> => {
	for (const candidate of resolveAuthFileCandidates(authFilePath)) {
		try {
			await access(candidate)
			return candidate
		} catch {}
	}

	return undefined
}

const findExistingCodexAuthFile = async (
	authFilePath: string | undefined,
): Promise<string | undefined> => {
	const candidate = resolveCodexAuthFilePath(authFilePath)
	try {
		await access(candidate)
		return candidate
	} catch {
		return undefined
	}
}

const canPrompt = (): boolean =>
	Boolean(process.stdin.isTTY && process.stdout.isTTY)

const parseConfirmationAnswer = (
	answer: string,
	defaultValue: boolean,
): boolean => {
	const normalized = answer.trim().toLowerCase()
	if (!normalized) {
		return defaultValue
	}

	return normalized === "y" || normalized === "yes"
}

const confirm = async (
	question: string,
	defaultValue: boolean,
): Promise<boolean> => {
	const suffix = defaultValue ? " [Y/n] " : " [y/N] "
	const readline = createInterface({
		input: process.stdin,
		output: process.stdout,
	})

	try {
		const answer = await readline.question(`${question}${suffix}`)
		return parseConfirmationAnswer(answer, defaultValue)
	} finally {
		readline.close()
	}
}

const toMissingAuthFilePrompt = (authFilePath: string | undefined): string => {
	const writePath = resolveCodexAuthFilePath(authFilePath)
	return [
		"No OpenAI OAuth credentials were found.",
		`Sign in with ChatGPT now? This will write credentials to ${writePath}.`,
	].join("\n")
}

const toOverwriteAuthFilePrompt = (authFilePath: string): string =>
	[
		`OpenAI OAuth credentials already exist at ${authFilePath}.`,
		"Sign in with ChatGPT again and overwrite them?",
	].join("\n")

const toMissingAuthFileMessage = (authFilePath: string | undefined): string => {
	if (authFilePath) {
		return [
			`No auth file was found at ${authFilePath}.`,
			"Run `npx openai-oauth login` and try again.",
		].join("\n")
	}

	const candidates = resolveAuthFileCandidates(undefined)
	return [
		`No auth file was found in the default search paths: ${candidates.join(", ")}.`,
		"Run `npx openai-oauth login` and try again.",
	].join("\n")
}

const runUpdateCheck = () =>
	checkForOpenAIOAuthUpdates(packageVersion, {
		onWarning: defaultUpdateCheckWarning,
	})

const createLoginCancellation = (): LoginCancellation => {
	const abortController = new AbortController()
	let signalName: NodeJS.Signals | undefined
	const abort = (receivedSignal: NodeJS.Signals) => {
		signalName = receivedSignal
		abortController.abort()
	}
	const onSigint = () => abort("SIGINT")
	const onSigterm = () => abort("SIGTERM")

	process.once("SIGINT", onSigint)
	process.once("SIGTERM", onSigterm)

	return {
		signal: abortController.signal,
		exitCode: () => (signalName === "SIGTERM" ? 143 : 130),
		dispose: () => {
			process.off("SIGINT", onSigint)
			process.off("SIGTERM", onSigterm)
		},
	}
}

const isLoginCancelledError = (error: unknown): boolean =>
	error instanceof Error && error.message === "OpenAI OAuth login cancelled."

const runLoginWithCancellation = async (
	options: ReturnType<typeof toLoginOptions>,
): Promise<boolean> => {
	const cancellation = createLoginCancellation()
	try {
		await runOpenAIOAuthLogin({
			...options,
			signal: cancellation.signal,
		})
		return true
	} catch (error) {
		if (cancellation.signal.aborted && isLoginCancelledError(error)) {
			process.exitCode = cancellation.exitCode()
			console.error("\nLogin cancelled.")
			return false
		}
		throw error
	} finally {
		cancellation.dispose()
	}
}

export const runCli = async (argv: string[] = hideBin(process.argv)) => {
	if (isHelpFlag(argv)) {
		console.log(toHelpMessage())
		return
	}

	if (isVersionFlag(argv)) {
		console.log(packageVersion)
		return
	}

	installCliWarningLogger()

	const args = parseCliArgs(argv)
	const updateCheck = runUpdateCheck()

	if (args.command === "login") {
		await updateCheck
		const loginOptions = toLoginOptions(args)
		const existingAuthFile = await findExistingCodexAuthFile(
			loginOptions.authFilePath,
		)
		if (existingAuthFile) {
			if (!canPrompt()) {
				throw new Error(
					[
						`OpenAI OAuth credentials already exist at ${existingAuthFile}.`,
						"Run `npx openai-oauth login` in an interactive terminal to confirm overwrite.",
					].join("\n"),
				)
			}

			const shouldOverwrite = await confirm(
				toOverwriteAuthFilePrompt(existingAuthFile),
				false,
			)
			if (!shouldOverwrite) {
				console.log("Login cancelled.")
				return
			}
		}

		await runLoginWithCancellation(loginOptions)
		return
	}

	const options = toServerOptions(args)
	const existingAuthFile = await findExistingAuthFile(options.authFilePath)
	if (!existingAuthFile) {
		await updateCheck
		if (!canPrompt()) {
			throw new Error(toMissingAuthFileMessage(options.authFilePath))
		}

		const shouldLogin = await confirm(
			toMissingAuthFilePrompt(options.authFilePath),
			true,
		)
		if (!shouldLogin) {
			console.log("Login cancelled.")
			return
		}

		const didLogin = await runLoginWithCancellation(toLoginOptions(args))
		if (!didLogin) {
			return
		}
	}

	const auth = openaiCredentials(options)
	const client = createCodexOAuthClient({
		...options,
		auth: () => auth.getSession(),
		responsesState: false as const,
	})
	const availableModels = await resolveOpenAIOAuthModels(
		client,
		options.models,
		{
			codexVersion: options.codexVersion,
			onWarning: (message) => {
				console.error(message)
			},
		},
	)
	const server = await startOpenAIOAuthServer(options)

	console.log(
		toStartupMessage(
			`http://${server.host}:${server.port}/v1`,
			availableModels,
			{
				useColor: process.stdout.isTTY,
			},
		),
	)

	void updateCheck

	const shutdown = async () => {
		await server.close()
		process.exit(0)
	}

	process.on("SIGINT", () => {
		void shutdown()
	})

	process.on("SIGTERM", () => {
		void shutdown()
	})
}

export {
	createCliParser,
	parseConfirmationAnswer,
	toMissingAuthFileMessage,
	toMissingAuthFilePrompt,
	toOverwriteAuthFilePrompt,
}
