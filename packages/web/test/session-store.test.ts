import "fake-indexeddb/auto"
import { afterEach, describe, expect, test, vi } from "vitest"
import { createSessionStore } from "../src/index.js"

const transactionDone = (transaction: IDBTransaction) =>
	new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve()
		transaction.onerror = () => reject(transaction.error)
	})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("browser session store", () => {
	test("persists, reads, and clears an encrypted session", async () => {
		vi.stubGlobal("window", globalThis)
		const store = createSessionStore({ dbName: "session-store-roundtrip" })
		const session = { accessToken: "token", accountId: "account" }

		await store.set(session)
		await expect(store.get()).resolves.toEqual(session)
		await store.clear()
		await expect(store.get()).resolves.toBeNull()
	})

	test("surfaces malformed stored sessions", async () => {
		vi.stubGlobal("window", globalThis)
		const dbName = "session-store-malformed"
		const store = createSessionStore({ dbName })
		await store.set({ accessToken: "token", accountId: "account" })

		const request = indexedDB.open(dbName)
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			request.onsuccess = () => resolve(request.result)
			request.onerror = () => reject(request.error)
		})
		const transaction = db.transaction("sessions", "readwrite")
		transaction.objectStore("sessions").put({
			id: "openai-oauth:session",
			value: { iv: 1, ciphertext: null },
		})
		await transactionDone(transaction)
		db.close()

		await expect(store.get()).rejects.toThrow(
			"stored OpenAI OAuth session is malformed",
		)
	})
})
