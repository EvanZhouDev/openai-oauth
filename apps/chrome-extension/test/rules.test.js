import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const readJson = (path) => JSON.parse(readFileSync(join(root, path), "utf8"))

describe("Chrome callback rule", () => {
	test("redirects only the complete localhost callback", () => {
		const [rule] = readJson("rules/openai-oauth-callback.json")
		expect(rule.condition).toEqual({
			regexFilter: "^http://localhost:1455/auth/callback(\\?.*)?$",
			resourceTypes: ["main_frame"],
		})
		expect(rule.action.redirect.regexSubstitution).toBe(
			"chrome-extension://odbgboachaefbbbdiffcefhpkekhfcna/src/confirm.html#\\0",
		)
	})

	test("requests only the callback host permission", () => {
		const manifest = readJson("manifest.json")
		expect(manifest.permissions).toEqual([
			"declarativeNetRequestWithHostAccess",
		])
		expect(manifest.host_permissions).toEqual(["http://localhost:1455/*"])
	})
})
