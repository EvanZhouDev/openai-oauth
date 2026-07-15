import { type ChildProcess, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { promises as fs } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { toAlreadyRunningMessage } from "./cli-logging.js"

const runtimeSchemaVersion = 1
const controlHost = "127.0.0.1"
const internalRuntimeDirectoryVariable = "OPENAI_OAUTH_INTERNAL_RUNTIME_DIR"
const internalDetachedFlag = "--internal-detached-child"

export type CliRuntimeMode = "foreground" | "background"

export type CliRuntimeState = {
	schemaVersion: typeof runtimeSchemaVersion
	instanceId: string
	pid: number
	mode: CliRuntimeMode
	url: string
	startedAt: string
	version: string
	controlPort: number
	controlToken: string
}

type RuntimePaths = {
	directory: string
	state: string
	lock: string
	log: string
}

type RuntimeLock = {
	paths: RuntimePaths
	release: () => Promise<void>
}

export type ActiveCliRuntime = {
	state: CliRuntimeState
	logPath: string
	setMode: (mode: CliRuntimeMode) => Promise<void>
	close: () => Promise<void>
}

export type CliWorkerReadyMessage = {
	type: "openai-oauth:ready"
	url: string
	models: string[]
}

type CliWorkerErrorMessage = {
	type: "openai-oauth:error"
	message: string
}

type CliWorkerDetachedMessage = {
	type: "openai-oauth:detached"
}

export type CliWorkerStoppingMessage = {
	type: "openai-oauth:stopping"
	source: "remote"
}

type CliWorkerMessage =
	| CliWorkerReadyMessage
	| CliWorkerErrorMessage
	| CliWorkerDetachedMessage
	| CliWorkerStoppingMessage

export type ManagedCliWorker = {
	child: ChildProcess
	url: string
	models: string[]
	logPath: string
	detach: () => Promise<void>
	stop: () => Promise<void>
}

const waitForChildExit = (
	child: ChildProcess,
	timeoutMs: number,
): Promise<boolean> => {
	if (child.exitCode != null || child.signalCode != null) {
		return Promise.resolve(true)
	}

	return new Promise((resolve) => {
		const onExit = () => {
			clearTimeout(timeout)
			resolve(true)
		}
		const timeout = setTimeout(() => {
			child.off("exit", onExit)
			resolve(false)
		}, timeoutMs)
		child.once("exit", onExit)
	})
}

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
	error instanceof Error

const resolveRuntimeDirectory = (): string => {
	const override = process.env[internalRuntimeDirectoryVariable]
	if (override) {
		return override
	}

	if (process.platform === "darwin") {
		return path.join(
			os.homedir(),
			"Library",
			"Application Support",
			"openai-oauth",
		)
	}
	if (process.platform === "win32") {
		return path.join(
			process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
			"openai-oauth",
		)
	}

	return path.join(
		process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
		"openai-oauth",
	)
}

export const resolveCliRuntimePaths = (
	directory = resolveRuntimeDirectory(),
): RuntimePaths => ({
	directory,
	state: path.join(directory, "runtime.json"),
	lock: path.join(directory, "runtime.lock"),
	log: path.join(directory, "server.log"),
})

const ensureRuntimeDirectory = async (paths: RuntimePaths): Promise<void> => {
	await fs.mkdir(paths.directory, { recursive: true, mode: 0o700 })
	try {
		await fs.chmod(paths.directory, 0o700)
	} catch {}
}

const isRuntimeState = (value: unknown): value is CliRuntimeState => {
	if (typeof value !== "object" || value == null) {
		return false
	}

	const state = value as Partial<CliRuntimeState>
	return (
		state.schemaVersion === runtimeSchemaVersion &&
		typeof state.instanceId === "string" &&
		typeof state.pid === "number" &&
		(state.mode === "foreground" || state.mode === "background") &&
		typeof state.url === "string" &&
		typeof state.startedAt === "string" &&
		typeof state.version === "string" &&
		typeof state.controlPort === "number" &&
		typeof state.controlToken === "string"
	)
}

const readJson = async (filePath: string): Promise<unknown> => {
	try {
		return JSON.parse(await fs.readFile(filePath, "utf8"))
	} catch {
		return undefined
	}
}

const readRuntimeState = async (
	paths: RuntimePaths,
): Promise<CliRuntimeState | undefined> => {
	const parsed = await readJson(paths.state)
	return isRuntimeState(parsed) ? parsed : undefined
}

const writeRuntimeState = async (
	paths: RuntimePaths,
	state: CliRuntimeState,
): Promise<void> => {
	const temporaryPath = `${paths.state}.${process.pid}.${randomBytes(4).toString("hex")}`
	await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
		mode: 0o600,
	})
	await fs.rename(temporaryPath, paths.state)
	try {
		await fs.chmod(paths.state, 0o600)
	} catch {}
}

const isProcessAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return isNodeError(error) && error.code === "EPERM"
	}
}

const readLockPid = async (
	paths: RuntimePaths,
): Promise<number | undefined> => {
	const parsed = await readJson(paths.lock)
	if (typeof parsed !== "object" || parsed == null) {
		return undefined
	}
	const pid = (parsed as { pid?: unknown }).pid
	return typeof pid === "number" ? pid : undefined
}

const removeIfPresent = async (filePath: string): Promise<void> => {
	await fs.rm(filePath, { force: true }).catch(() => undefined)
}

const fetchWithTimeout = async (
	input: string,
	init: RequestInit,
	timeoutMs = 750,
): Promise<Response> => {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), timeoutMs)
	if (typeof timeout === "object" && "unref" in timeout) {
		timeout.unref()
	}

	try {
		return await fetch(input, { ...init, signal: controller.signal })
	} finally {
		clearTimeout(timeout)
	}
}

const probeRuntime = async (state: CliRuntimeState): Promise<boolean> => {
	try {
		const response = await fetchWithTimeout(
			`http://${controlHost}:${state.controlPort}/state`,
			{
				headers: { authorization: `Bearer ${state.controlToken}` },
			},
		)
		if (!response.ok) {
			return false
		}
		const body = (await response.json()) as { instanceId?: unknown }
		return body.instanceId === state.instanceId
	} catch {
		return false
	}
}

export const findRunningCliRuntime = async (
	directory?: string,
): Promise<CliRuntimeState | undefined> => {
	const paths = resolveCliRuntimePaths(directory)
	const state = await readRuntimeState(paths)
	if (!state) {
		return undefined
	}

	for (let attempt = 0; attempt < 3; attempt += 1) {
		if (await probeRuntime(state)) {
			return state
		}
		await delay(50)
	}

	await removeIfPresent(paths.state)
	await removeIfPresent(paths.lock)
	return undefined
}

export class CliRuntimeAlreadyRunningError extends Error {
	readonly state: CliRuntimeState

	constructor(state: CliRuntimeState) {
		super(toAlreadyRunningMessage(state.url))
		this.name = "CliRuntimeAlreadyRunningError"
		this.state = state
	}
}

export const acquireCliRuntimeLock = async (
	directory?: string,
): Promise<RuntimeLock> => {
	const paths = resolveCliRuntimePaths(directory)
	await ensureRuntimeDirectory(paths)

	for (let attempt = 0; attempt < 50; attempt += 1) {
		try {
			const handle = await fs.open(paths.lock, "wx", 0o600)
			await handle.writeFile(
				`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
			)
			await handle.close()

			let released = false
			return {
				paths,
				release: async () => {
					if (released) {
						return
					}
					released = true
					await removeIfPresent(paths.lock)
				},
			}
		} catch (error) {
			if (!isNodeError(error) || error.code !== "EEXIST") {
				throw error
			}

			const running = await findRunningCliRuntime(directory)
			if (running) {
				throw new CliRuntimeAlreadyRunningError(running)
			}

			const ownerPid = await readLockPid(paths)
			if (ownerPid == null || !isProcessAlive(ownerPid)) {
				await removeIfPresent(paths.lock)
				continue
			}

			await delay(100)
		}
	}

	throw new Error("OpenAI OAuth is already starting in another process.")
}

const closeServer = (server: Server): Promise<void> =>
	new Promise((resolve, reject) => {
		if (!server.listening) {
			resolve()
			return
		}
		server.close((error) => {
			if (error) {
				reject(error)
				return
			}
			resolve()
		})
	})

export const activateCliRuntime = async (
	lock: RuntimeLock,
	options: {
		mode: CliRuntimeMode
		url: string
		version: string
		onStop: () => void | Promise<void>
	},
): Promise<ActiveCliRuntime> => {
	const instanceId = randomBytes(16).toString("hex")
	const controlToken = randomBytes(32).toString("hex")
	let state: CliRuntimeState

	const controlServer = createServer((request, response) => {
		if (request.headers.authorization !== `Bearer ${controlToken}`) {
			response.writeHead(401).end()
			return
		}

		if (request.method === "GET" && request.url === "/state") {
			response.writeHead(200, { "content-type": "application/json" })
			response.end(JSON.stringify({ instanceId: state.instanceId }))
			return
		}

		if (request.method === "POST" && request.url === "/stop") {
			response.writeHead(202).end()
			setImmediate(options.onStop)
			return
		}

		response.writeHead(404).end()
	})

	try {
		await new Promise<void>((resolve, reject) => {
			controlServer.once("error", reject)
			controlServer.listen(0, controlHost, () => {
				controlServer.off("error", reject)
				resolve()
			})
		})

		const address = controlServer.address() as AddressInfo
		state = {
			schemaVersion: runtimeSchemaVersion,
			instanceId,
			pid: process.pid,
			mode: options.mode,
			url: options.url,
			startedAt: new Date().toISOString(),
			version: options.version,
			controlPort: address.port,
			controlToken,
		}
		await writeRuntimeState(lock.paths, state)
	} catch (error) {
		await closeServer(controlServer).catch(() => undefined)
		await lock.release()
		throw error
	}

	let closed = false
	return {
		state,
		logPath: lock.paths.log,
		setMode: async (mode) => {
			if (state.mode === mode) {
				return
			}
			state = { ...state, mode }
			await writeRuntimeState(lock.paths, state)
		},
		close: async () => {
			if (closed) {
				return
			}
			closed = true

			const current = await readRuntimeState(lock.paths)
			if (current?.instanceId === state.instanceId) {
				await removeIfPresent(lock.paths.state)
			}
			await closeServer(controlServer).catch(() => undefined)
			await lock.release()
		},
	}
}

export const stopCliRuntime = async (
	state: CliRuntimeState,
	directory?: string,
): Promise<boolean> => {
	try {
		const response = await fetchWithTimeout(
			`http://${controlHost}:${state.controlPort}/stop`,
			{
				method: "POST",
				headers: { authorization: `Bearer ${state.controlToken}` },
			},
		)
		if (!response.ok) {
			return false
		}
	} catch {
		return false
	}

	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (!(await findRunningCliRuntime(directory))) {
			return true
		}
		await delay(100)
	}
	return false
}

const isCliWorkerMessage = (value: unknown): value is CliWorkerMessage => {
	if (typeof value !== "object" || value == null) {
		return false
	}
	const message = value as Partial<CliWorkerMessage>
	return (
		(message.type === "openai-oauth:ready" &&
			typeof message.url === "string" &&
			Array.isArray(message.models)) ||
		(message.type === "openai-oauth:error" &&
			typeof message.message === "string") ||
		message.type === "openai-oauth:detached" ||
		(message.type === "openai-oauth:stopping" && message.source === "remote")
	)
}

const waitForWorkerMessage = <Message extends CliWorkerMessage>(
	child: ChildProcess,
	predicate: (message: CliWorkerMessage) => message is Message,
	timeoutMs: number,
): Promise<Message> =>
	new Promise((resolve, reject) => {
		let settled = false
		const timeout = setTimeout(() => {
			finish(new Error(`OpenAI OAuth did not respond within ${timeoutMs}ms.`))
		}, timeoutMs)

		const cleanup = () => {
			clearTimeout(timeout)
			child.off("message", onMessage)
			child.off("error", onError)
			child.off("exit", onExit)
		}
		const finish = (error?: Error, message?: Message) => {
			if (settled) {
				return
			}
			settled = true
			cleanup()
			if (error) {
				reject(error)
				return
			}
			if (!message) {
				reject(new Error("OpenAI OAuth worker returned an empty response."))
				return
			}
			resolve(message)
		}
		const onMessage = (value: unknown) => {
			if (!isCliWorkerMessage(value)) {
				return
			}
			if (value.type === "openai-oauth:error") {
				finish(new Error(value.message))
				return
			}
			if (predicate(value)) {
				finish(undefined, value)
			}
		}
		const onError = (error: Error) => finish(error)
		const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
			finish(
				new Error(
					`OpenAI OAuth exited unexpectedly (${signal ?? code ?? "unknown"}).`,
				),
			)

		child.on("message", onMessage)
		child.once("error", onError)
		child.once("exit", onExit)
	})

export const startCliWorker = async (
	argv: string[],
	options: {
		entryPath?: string
		runtimeDirectory?: string
		timeoutMs?: number
	} = {},
): Promise<ManagedCliWorker> => {
	const paths = resolveCliRuntimePaths(options.runtimeDirectory)
	await ensureRuntimeDirectory(paths)
	const logHandle = await fs.open(paths.log, "a", 0o600)
	let child: ReturnType<typeof spawn>
	const entryPath = options.entryPath ?? process.argv[1]
	if (!entryPath) {
		await logHandle.close()
		throw new Error("Could not resolve the OpenAI OAuth CLI entrypoint.")
	}

	try {
		child = spawn(
			process.execPath,
			[
				entryPath,
				...argv.filter((argument) => argument !== internalDetachedFlag),
				internalDetachedFlag,
			],
			{
				detached: true,
				windowsHide: true,
				stdio: ["ignore", logHandle.fd, logHandle.fd, "ipc"],
				env: {
					...process.env,
					...(options.runtimeDirectory
						? {
								[internalRuntimeDirectoryVariable]: options.runtimeDirectory,
							}
						: {}),
				},
			},
		)
	} finally {
		await logHandle.close()
	}

	let ready: CliWorkerReadyMessage
	try {
		ready = await waitForWorkerMessage(
			child,
			(message): message is CliWorkerReadyMessage =>
				message.type === "openai-oauth:ready",
			options.timeoutMs ?? 15_000,
		)
	} catch (error) {
		if (child.pid) {
			try {
				process.kill(child.pid, "SIGTERM")
			} catch {}
		}
		if (child.connected) {
			child.disconnect()
		}
		child.unref()
		throw error
	}

	return {
		child,
		url: ready.url,
		models: ready.models,
		logPath: paths.log,
		detach: async () => {
			const acknowledged = waitForWorkerMessage(
				child,
				(message): message is CliWorkerDetachedMessage =>
					message.type === "openai-oauth:detached",
				5_000,
			)
			child.send?.({ type: "openai-oauth:detach" })
			await acknowledged
			if (child.connected) {
				child.disconnect()
			}
			child.unref()
		},
		stop: async () => {
			child.send?.({ type: "openai-oauth:stop" })
			if (await waitForChildExit(child, 5_000)) {
				return
			}

			child.kill("SIGTERM")
			if (await waitForChildExit(child, 1_000)) {
				return
			}

			if (child.connected) {
				child.disconnect()
			}
			child.unref()
			throw new Error("OpenAI OAuth did not stop within 6000ms.")
		},
	}
}

const readLogSlice = async (
	filePath: string,
	start: number,
): Promise<{ text: string; size: number }> => {
	try {
		const stat = await fs.stat(filePath)
		const safeStart = stat.size < start ? 0 : start
		if (stat.size === safeStart) {
			return { text: "", size: stat.size }
		}

		const handle = await fs.open(filePath, "r")
		try {
			const buffer = Buffer.alloc(stat.size - safeStart)
			await handle.read(buffer, 0, buffer.length, safeStart)
			return { text: buffer.toString("utf8"), size: stat.size }
		} finally {
			await handle.close()
		}
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return { text: "", size: 0 }
		}
		throw error
	}
}

export const readRecentCliLogs = async (
	directory?: string,
	lineCount = 50,
): Promise<string> => {
	const { log } = resolveCliRuntimePaths(directory)
	try {
		const stat = await fs.stat(log)
		const start = Math.max(0, stat.size - 64 * 1024)
		const { text } = await readLogSlice(log, start)
		return text
			.split("\n")
			.slice(-lineCount - 1)
			.join("\n")
			.trimEnd()
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return ""
		}
		throw error
	}
}

export const followCliLogs = async (
	write: (text: string) => void,
	signal: AbortSignal,
	directory?: string,
	fromStart = false,
): Promise<void> => {
	const { log } = resolveCliRuntimePaths(directory)
	let offset = 0
	if (!fromStart) {
		try {
			offset = (await fs.stat(log)).size
		} catch {}
	}

	while (!signal.aborted) {
		try {
			await delay(250, undefined, { signal })
		} catch {
			break
		}
		const next = await readLogSlice(log, offset)
		offset = next.size
		if (next.text) {
			write(next.text)
		}
	}
}

export const sendDetachedReady = (url: string, models: string[]): void => {
	process.send?.({ type: "openai-oauth:ready", url, models })
}

export const sendDetachedAcknowledgement = (): void => {
	process.send?.({ type: "openai-oauth:detached" })
}

export const sendRemoteStopping = (): Promise<void> =>
	new Promise((resolve) => {
		if (!process.send) {
			resolve()
			return
		}
		process.send({ type: "openai-oauth:stopping", source: "remote" }, () =>
			resolve(),
		)
	})

export const sendDetachedError = (message: string): Promise<void> =>
	new Promise((resolve) => {
		if (!process.send) {
			resolve()
			return
		}
		process.send({ type: "openai-oauth:error", message }, () => resolve())
	})
