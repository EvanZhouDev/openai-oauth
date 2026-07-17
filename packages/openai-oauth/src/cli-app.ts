import { access } from "node:fs/promises"
import { createInterface } from "node:readline/promises"
import {
	resolveAuthFileCandidates,
	resolveCodexAuthFilePath,
} from "@openai-oauth/local/auth-file"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import {
	cliMessages,
	installCliWarningLogger,
	toAlreadyRunningMessage,
	toBackgroundStartupMessage,
	toDetachedMessage,
	toForegroundStartupMessage,
	toRunningMessage,
} from "./cli-logging.js"
import {
	type CliWorkerStoppingMessage,
	findRunningCliRuntime,
	followCliLogs,
	type ManagedCliWorker,
	readRecentCliLogs,
	sendDetachedError,
	startCliWorker,
	stopCliRuntime,
} from "./cli-runtime.js"
import { runCliWorker } from "./cli-worker.js"
import { runOpenAIOAuthLogin } from "./login.js"
import { DEFAULT_PORT } from "./shared.js"
import { checkForOpenAIOAuthUpdates } from "./update-check.js"
import { packageVersion } from "./version.js"

const cliCommand = "npx openai-oauth@latest"

export type CliArgs = {
	command: "serve" | "login" | "logs" | "status" | "stop"
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
	responsesState: "stateless" | "memory"
	detach?: boolean
	follow?: boolean
	internalDetachedChild?: boolean
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
	`  ${cliCommand} [options]`,
	`  ${cliCommand} --detach [options]`,
	`  ${cliCommand} status`,
	`  ${cliCommand} logs [--follow]`,
	`  ${cliCommand} stop`,
	`  ${cliCommand} login [options]`,
	"",
	"Options",
	"  --host <host>              Proxy host. Login callback always listens on loopback.",
	"  --port <port>              Proxy port. Default: 10531.",
	"  --models <ids>             Comma-separated model ids to expose from /v1/models.",
	"  --codex-version <version>  Override the Codex client version used for model discovery.",
	"  --base-url <url>           Override the upstream Codex base URL.",
	"  --oauth-client-id <id>     Override the OAuth client id used for refresh.",
	"  --oauth-token-url <url>    Override the OAuth token URL used for refresh.",
	"  --oauth-file <path>        Path to the local auth.json file.",
	"  --no-open                  Print the login URL without opening a browser.",
	"  --login-timeout-ms <ms>    Login timeout. Default: 300000",
	"  --responses-state <mode>   Responses continuation state: stateless or memory. Default: stateless; memory is process-local and non-persistent.",
	"",
	"Flags",
	"  -d, --detach               Run in the background",
	"  -f, --follow               Follow logs",
	"  --help                     Show help",
	`  --version                  Show version (${packageVersion})`,
	"",
	"Notes",
	"  If no auth file is found, run: npx openai-oauth login",
	"  By default, the latest Codex version and available account models are discovered automatically.",
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
			describe: "Override the Codex client version used for model discovery.",
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
		.option("responses-state", {
			type: "string",
			choices: ["stateless", "memory"] as const,
			default: "stateless" as const,
			describe:
				"Responses continuation state. Memory is process-local and non-persistent.",
		})
		.option("detach", {
			alias: "d",
			type: "boolean",
			default: false,
			describe: "Run in the background.",
		})
		.option("follow", {
			alias: "f",
			type: "boolean",
			default: false,
			describe: "Follow logs.",
		})
		.option("internal-detached-child", {
			type: "boolean",
			default: false,
		})
		.hide("internal-detached-child")

const isHelpFlag = (argv: string[]): boolean =>
	argv.includes("--help") || argv.includes("-h")

const isVersionFlag = (argv: string[]): boolean => argv.includes("--version")

export const toHelpMessage = (): string => helpLines.join("\n")

export const parseCliArgs = (argv: string[]): CliArgs => {
	const first = argv[0]
	if (
		first &&
		!first.startsWith("-") &&
		first !== "serve" &&
		first !== "login" &&
		first !== "logs" &&
		first !== "status" &&
		first !== "stop"
	) {
		throw new Error(`Unknown command: ${first}`)
	}
	const command: CliArgs["command"] =
		first === "login" ||
		first === "logs" ||
		first === "status" ||
		first === "stop"
			? first
			: "serve"
	const parsed = createCliParser(
		command === "serve" && first !== "serve" ? argv : argv.slice(1),
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
		responsesState: parsed.responsesState,
		detach: parsed.detach,
		follow: parsed.follow,
		internalDetachedChild: parsed.internalDetachedChild,
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
	responsesState: args.responsesState,
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

const toExistingAuthFileMessage = (authFilePath: string): string =>
	`OpenAI OAuth credentials already exist at ${authFilePath}.`

const toOverwriteAuthFilePrompt = (authFilePath: string): string =>
	[
		toExistingAuthFileMessage(authFilePath),
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

const warnAboutNetworkBinding = (host: string | undefined): void => {
	if (host && host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
		console.warn(
			`Warning: --host ${host} exposes OpenAI OAuth to your network. Anyone who can reach this port can make requests with your ChatGPT account.`,
		)
	}
}

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

const runLogsCommand = async (follow: boolean): Promise<void> => {
	const recent = await readRecentCliLogs()
	const running = await findRunningCliRuntime()
	if (!running) {
		console.log(cliMessages.notRunningWithStart)
		return
	}

	if (!follow) {
		console.log(recent || cliMessages.noLogs)
		return
	}

	console.log(cliMessages.followingLogs)
	if (recent) {
		console.log(recent)
	}

	const controller = new AbortController()
	const abort = () => controller.abort()
	process.once("SIGINT", abort)
	process.once("SIGTERM", abort)
	try {
		await followCliLogs((text) => process.stdout.write(text), controller.signal)
	} finally {
		process.off("SIGINT", abort)
		process.off("SIGTERM", abort)
	}
}

const runStopCommand = async (): Promise<void> => {
	const running = await findRunningCliRuntime()
	if (!running) {
		console.log(cliMessages.notRunning)
		return
	}

	if (!(await stopCliRuntime(running))) {
		throw new Error(cliMessages.couldNotStop)
	}
	console.log(cliMessages.stopped)
}

const runStatusCommand = async (): Promise<void> => {
	const running = await findRunningCliRuntime()
	if (!running) {
		console.log(cliMessages.notRunningWithStart)
		process.exitCode = 1
		return
	}

	console.log(toRunningMessage(running.url))
}

const runForegroundController = async (
	worker: ManagedCliWorker,
): Promise<void> =>
	new Promise((resolve, reject) => {
		const interactive = canPrompt()
		const stdin = process.stdin
		const logController = new AbortController()
		const previousRawMode = stdin.isRaw
		let menuShown = false
		let completing = false
		let remoteStopping = false
		let rawModeEnabled = false

		const cleanup = () => {
			logController.abort()
			stdin.off("data", onData)
			process.off("SIGINT", onSigint)
			process.off("SIGTERM", onSigterm)
			worker.child.off("message", onWorkerMessage)
			worker.child.off("error", onWorkerError)
			worker.child.off("exit", onWorkerExit)
			if (rawModeEnabled && stdin.setRawMode) {
				stdin.setRawMode(previousRawMode ?? false)
			}
			if (interactive) {
				stdin.pause()
			}
		}

		const finish = (error?: Error) => {
			cleanup()
			if (error) {
				reject(error)
				return
			}
			resolve()
		}

		const quit = async (showMessage: boolean) => {
			if (completing) {
				return
			}
			completing = true
			try {
				await worker.stop()
				if (showMessage) {
					console.log(`\n${cliMessages.stopped}`)
				}
				finish()
			} catch (error) {
				finish(
					error instanceof Error ? error : new Error(cliMessages.couldNotStop),
				)
			}
		}

		const detach = async () => {
			if (completing) {
				return
			}
			completing = true
			try {
				await worker.detach()
				console.log(`\n${toDetachedMessage(worker.url)}`)
				finish()
			} catch (error) {
				completing = false
				console.error(
					`\n${cliMessages.couldNotDetach(
						error instanceof Error ? error.message : undefined,
					)}`,
				)
			}
		}

		const handleInterrupt = () => {
			if (!interactive || menuShown) {
				void quit(interactive)
				return
			}
			menuShown = true
			console.log(`\n${cliMessages.foregroundControls}`)
		}

		function onData(value: Buffer | string) {
			const input = value.toString().toLowerCase()
			if (input.includes("\u0003")) {
				handleInterrupt()
				return
			}
			if (input.includes("d")) {
				void detach()
				return
			}
			if (input.includes("q")) {
				void quit(true)
			}
		}
		function onSigint() {
			handleInterrupt()
		}
		function onSigterm() {
			void quit(false)
		}
		function onWorkerMessage(value: unknown) {
			const message = value as Partial<CliWorkerStoppingMessage>
			if (
				message.type === "openai-oauth:stopping" &&
				message.source === "remote"
			) {
				remoteStopping = true
			}
		}
		function onWorkerError(error: Error) {
			if (!completing) {
				finish(error)
			}
		}
		function onWorkerExit(code: number | null, signal: NodeJS.Signals | null) {
			if (completing) {
				return
			}
			if (remoteStopping) {
				console.log(`\n${cliMessages.stoppedRemotely}`)
				finish()
				return
			}
			finish(
				new Error(
					cliMessages.stoppedUnexpectedly(signal ?? `${code ?? "unknown"}`),
				),
			)
		}

		if (interactive) {
			if (stdin.setRawMode) {
				stdin.setRawMode(true)
				rawModeEnabled = true
			}
			stdin.resume()
			stdin.on("data", onData)
		}
		process.on("SIGINT", onSigint)
		process.on("SIGTERM", onSigterm)
		worker.child.on("message", onWorkerMessage)
		worker.child.once("error", onWorkerError)
		worker.child.once("exit", onWorkerExit)

		void followCliLogs(
			(text) => process.stdout.write(text),
			logController.signal,
		).catch((error) => {
			if (!logController.signal.aborted) {
				console.error(error instanceof Error ? error.message : error)
			}
		})
	})

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

	if (args.internalDetachedChild) {
		try {
			await runCliWorker(
				toServerOptions(args),
				args.detach ? "background" : "foreground",
				packageVersion,
			)
		} catch (error) {
			await sendDetachedError(
				error instanceof Error
					? error.message
					: "Failed to start OpenAI OAuth.",
			)
			throw error
		}
		return
	}

	if (args.command === "logs") {
		await runLogsCommand(Boolean(args.follow))
		return
	}

	if (args.command === "stop") {
		await runStopCommand()
		return
	}

	if (args.command === "status") {
		await runStatusCommand()
		return
	}

	if (args.command === "login") {
		const updateCheck = runUpdateCheck()
		await updateCheck
		const loginOptions = toLoginOptions(args)
		const existingAuthFile = await findExistingCodexAuthFile(
			loginOptions.authFilePath,
		)
		if (existingAuthFile) {
			if (!canPrompt()) {
				throw new Error(
					[
						toExistingAuthFileMessage(existingAuthFile),
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

	const running = await findRunningCliRuntime()
	if (running) {
		console.log(toAlreadyRunningMessage(running.url))
		return
	}

	const updateCheck = runUpdateCheck()
	const options = toServerOptions(args)
	warnAboutNetworkBinding(options.host)
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

	const worker = await startCliWorker(argv)
	await updateCheck
	if (args.detach) {
		await worker.detach()
		console.log(
			toBackgroundStartupMessage(worker.url, worker.models, {
				useColor: process.stdout.isTTY,
			}),
		)
		return
	}

	console.log(
		toForegroundStartupMessage(worker.url, worker.models, {
			useColor: process.stdout.isTTY,
		}),
	)
	await runForegroundController(worker)
}

export {
	createCliParser,
	parseConfirmationAnswer,
	toMissingAuthFileMessage,
	toMissingAuthFilePrompt,
	toOverwriteAuthFilePrompt,
}
