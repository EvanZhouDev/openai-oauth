import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	type ActiveCliRuntime,
	acquireCliRuntimeLock,
	activateCliRuntime,
	CliRuntimeAlreadyRunningError,
	findRunningCliRuntime,
	followCliLogs,
	readRecentCliLogs,
	resolveCliRuntimePaths,
	stopCliRuntime,
} from "../src/cli-runtime.js"

describe("CLI runtime", () => {
	let directory: string
	const activeRuntimes = new Set<ActiveCliRuntime>()

	beforeEach(async () => {
		directory = await fs.mkdtemp(
			path.join(os.tmpdir(), "openai-oauth-runtime-"),
		)
	})

	afterEach(async () => {
		for (const runtime of activeRuntimes) {
			await runtime.close()
		}
		activeRuntimes.clear()
		await fs.rm(directory, { recursive: true, force: true })
	})

	const activate = async (
		onStop: () => void | Promise<void> = () => undefined,
	): Promise<ActiveCliRuntime> => {
		const lock = await acquireCliRuntimeLock(directory)
		const runtime = await activateCliRuntime(lock, {
			mode: "background",
			url: "http://127.0.0.1:10531/v1",
			version: "2.0.0-test",
			onStop,
		})
		activeRuntimes.add(runtime)
		return runtime
	}

	test("activates and probes a running instance", async () => {
		const runtime = await activate()

		await expect(findRunningCliRuntime(directory)).resolves.toEqual(
			runtime.state,
		)
		await expect(
			fs.readFile(resolveCliRuntimePaths(directory).state, "utf8"),
		).resolves.toContain(runtime.state.instanceId)

		await runtime.setMode("foreground")
		await expect(findRunningCliRuntime(directory)).resolves.toMatchObject({
			instanceId: runtime.state.instanceId,
			mode: "foreground",
		})
	})

	test("rejects a second runtime while one is active", async () => {
		const runtime = await activate()

		await expect(acquireCliRuntimeLock(directory)).rejects.toMatchObject({
			name: "CliRuntimeAlreadyRunningError",
			state: { instanceId: runtime.state.instanceId },
		})
		await expect(acquireCliRuntimeLock(directory)).rejects.toBeInstanceOf(
			CliRuntimeAlreadyRunningError,
		)
	})

	test("authenticates stop requests and cleans up runtime files", async () => {
		const onStop = vi.fn()
		let runtime: ActiveCliRuntime
		runtime = await activate(async () => {
			onStop()
			await runtime.close()
			activeRuntimes.delete(runtime)
		})
		const paths = resolveCliRuntimePaths(directory)
		const controlUrl = `http://127.0.0.1:${runtime.state.controlPort}/stop`

		const unauthorized = await fetch(controlUrl, {
			method: "POST",
			headers: { authorization: "Bearer incorrect-token" },
		})
		expect(unauthorized.status).toBe(401)
		expect(onStop).not.toHaveBeenCalled()

		await expect(stopCliRuntime(runtime.state, directory)).resolves.toBe(true)
		expect(onStop).toHaveBeenCalledOnce()
		await expect(findRunningCliRuntime(directory)).resolves.toBeUndefined()
		await expect(fs.stat(paths.state)).rejects.toMatchObject({ code: "ENOENT" })
		await expect(fs.stat(paths.lock)).rejects.toMatchObject({ code: "ENOENT" })
	})

	test("removes stale metadata and its lock", async () => {
		const paths = resolveCliRuntimePaths(directory)
		await fs.mkdir(directory, { recursive: true })
		await fs.writeFile(
			paths.state,
			JSON.stringify({
				schemaVersion: 1,
				instanceId: "stale-instance",
				pid: 2_147_483_647,
				mode: "background",
				url: "http://127.0.0.1:10531/v1",
				startedAt: new Date(0).toISOString(),
				version: "2.0.0-test",
				controlPort: 1,
				controlToken: "stale-token",
			}),
		)
		await fs.writeFile(paths.lock, JSON.stringify({ pid: 2_147_483_647 }))

		await expect(findRunningCliRuntime(directory)).resolves.toBeUndefined()
		await expect(fs.stat(paths.state)).rejects.toMatchObject({ code: "ENOENT" })
		await expect(fs.stat(paths.lock)).rejects.toMatchObject({ code: "ENOENT" })
	})

	test("returns only the requested recent log lines", async () => {
		const { log } = resolveCliRuntimePaths(directory)
		await fs.mkdir(directory, { recursive: true })
		await fs.writeFile(log, "one\ntwo\nthree\nfour\n")

		await expect(readRecentCliLogs(directory, 2)).resolves.toBe("three\nfour")
		await expect(
			readRecentCliLogs(path.join(directory, "missing")),
		).resolves.toBe("")
	})

	test("follows appended logs until aborted", async () => {
		const { log } = resolveCliRuntimePaths(directory)
		await fs.mkdir(directory, { recursive: true })
		await fs.writeFile(log, "existing\n")
		const controller = new AbortController()
		const chunks: string[] = []
		const following = followCliLogs(
			(text) => chunks.push(text),
			controller.signal,
			directory,
		)

		await fs.appendFile(log, "appended\n")
		for (let attempt = 0; attempt < 20 && chunks.length === 0; attempt += 1) {
			await delay(50)
		}
		controller.abort()

		await expect(following).resolves.toBeUndefined()
		expect(chunks.join("")).toBe("appended\n")
	})
})
