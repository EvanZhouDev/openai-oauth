import { describe, expect, test } from "vitest"
import {
	checkForOpenAIOAuthUpdates,
	compareSemver,
	normalizeVersion,
} from "../src/update-check.js"

describe("update check", () => {
	test("compareSemver compares basic versions", () => {
		expect(compareSemver("0.0.1", "0.0.2")).toBeLessThan(0)
		expect(compareSemver("0.1.0", "0.0.9")).toBeGreaterThan(0)
		expect(compareSemver("1.2.3", "1.2.3")).toBe(0)
	})

	test("normalizeVersion accepts plain semver only", () => {
		expect(normalizeVersion("0.114.0")).toBe("0.114.0")
		expect(normalizeVersion("codex-cli 0.114.0")).toBeUndefined()
	})

	test("warns when a newer version is available", async () => {
		const warnings: string[] = []

		await checkForOpenAIOAuthUpdates("0.0.1", {
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						version: "0.0.4",
					}),
					{
						status: 200,
						headers: {
							"Content-Type": "application/json",
						},
					},
				),
			onWarning: (message) => {
				warnings.push(message)
			},
		})

		expect(warnings).toEqual([
			"A newer version of openai-oauth is available: 0.0.1 -> 0.0.4.\nRun `npx openai-oauth@latest` to use the newest version.",
		])
	})

	test("does not warn when the current version is up to date", async () => {
		const warnings: string[] = []

		await checkForOpenAIOAuthUpdates("0.0.4", {
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						version: "0.0.4",
					}),
					{
						status: 200,
						headers: {
							"Content-Type": "application/json",
						},
					},
				),
			onWarning: (message) => {
				warnings.push(message)
			},
		})

		expect(warnings).toEqual([])
	})

	test("fails quietly when the registry request fails", async () => {
		const warnings: string[] = []

		await checkForOpenAIOAuthUpdates("0.0.1", {
			fetchImpl: async () => {
				throw new Error("offline")
			},
			onWarning: (message) => {
				warnings.push(message)
			},
		})

		expect(warnings).toEqual([])
	})
})
