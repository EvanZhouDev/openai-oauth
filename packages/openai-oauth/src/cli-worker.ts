import { cliMessages } from "./cli-logging.js"
import {
	type ActiveCliRuntime,
	acquireCliRuntimeLock,
	activateCliRuntime,
	type CliRuntimeMode,
	sendDetachedAcknowledgement,
	sendDetachedError,
	sendDetachedReady,
	sendRemoteStopping,
} from "./cli-runtime.js"
import { startOpenAIOAuthServer } from "./server.js"
import type {
	OpenAIOAuthServerOptions,
	RunningOpenAIOAuthServer,
} from "./types.js"

type WorkerCommand =
	| { type: "openai-oauth:detach" }
	| { type: "openai-oauth:stop" }

const isWorkerCommand = (value: unknown): value is WorkerCommand => {
	if (typeof value !== "object" || value == null) {
		return false
	}
	const type = (value as { type?: unknown }).type
	return type === "openai-oauth:detach" || type === "openai-oauth:stop"
}

const startCliInstance = async (
	options: OpenAIOAuthServerOptions,
	mode: CliRuntimeMode,
	version: string,
	onRemoteStop: () => void | Promise<void>,
): Promise<{
	server: RunningOpenAIOAuthServer
	runtime: ActiveCliRuntime
	models: string[]
}> => {
	const lock = await acquireCliRuntimeLock()
	let server: RunningOpenAIOAuthServer | undefined

	try {
		server = await startOpenAIOAuthServer(options)
		const runtime = await activateCliRuntime(lock, {
			mode,
			url: server.url,
			version,
			onStop: onRemoteStop,
		})
		return { server, runtime, models: server.models }
	} catch (error) {
		await server?.close().catch(() => undefined)
		await lock.release()
		throw error
	}
}

export const runCliWorker = async (
	options: OpenAIOAuthServerOptions,
	initialMode: CliRuntimeMode,
	version: string,
): Promise<void> => {
	if (typeof process.send !== "function") {
		throw new Error("OpenAI OAuth worker requires an IPC channel.")
	}

	let detached = false
	let stopping = false
	let instance: Awaited<ReturnType<typeof startCliInstance>> | undefined

	const shutdown = async (
		source: "parent" | "remote" | "signal" | "disconnect",
	) => {
		if (stopping) {
			return
		}
		stopping = true

		if (source === "remote") {
			await sendRemoteStopping()
		}

		await instance?.server.close().catch(() => undefined)
		await instance?.runtime.close().catch(() => undefined)
		if (process.connected) {
			process.disconnect()
		}
		process.exit(0)
	}

	instance = await startCliInstance(options, initialMode, version, () =>
		shutdown("remote"),
	)

	const onMessage = (value: unknown) => {
		if (!isWorkerCommand(value) || stopping) {
			return
		}

		if (value.type === "openai-oauth:stop") {
			void shutdown("parent")
			return
		}

		void (async () => {
			try {
				await instance?.runtime.setMode("background")
				detached = true
				sendDetachedAcknowledgement()
			} catch (error) {
				await sendDetachedError(
					error instanceof Error ? error.message : cliMessages.couldNotDetach(),
				)
			}
		})()
	}
	const onDisconnect = () => {
		if (!detached) {
			void shutdown("disconnect")
		}
	}
	const onSignal = () => shutdown("signal")

	process.on("message", onMessage)
	process.once("disconnect", onDisconnect)
	process.once("SIGINT", onSignal)
	process.once("SIGTERM", onSignal)

	console.log(cliMessages.workerStarted(instance.server.url))
	sendDetachedReady(instance.server.url, instance.models)
}
