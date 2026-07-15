import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { callbackRuleId, createCallbackRule } from "../src/rules.js"

const root = join(import.meta.dir, "..")

describe("Firefox callback rule", () => {
	test("redirects the complete localhost callback to the runtime extension URL", () => {
		const rule = createCallbackRule(
			"moz-extension://runtime-id/src/confirm.html",
		)

		expect(rule.id).toBe(callbackRuleId)
		expect(rule.condition).toEqual({
			regexFilter: "^http://localhost:1455/auth/callback(\\?.*)?$",
			resourceTypes: ["main_frame"],
		})
		expect(rule.action.redirect.regexSubstitution).toBe(
			"moz-extension://runtime-id/src/confirm.html#\\0",
		)
	})

	test("requests Firefox's narrowest supported localhost permission", () => {
		const manifest = JSON.parse(
			readFileSync(join(root, "manifest.json"), "utf8"),
		)

		expect(manifest.permissions).toEqual([
			"declarativeNetRequestWithHostAccess",
		])
		expect(manifest.host_permissions).toEqual(["http://localhost/*"])
		expect(manifest.browser_specific_settings.gecko.id).toBe(
			"sign-in-with-chatgpt@openai-oauth",
		)
	})

	test("limits installation detection to localhost port 1455", () => {
		const rules = JSON.parse(
			readFileSync(join(root, "rules/openai-oauth-detection.json"), "utf8"),
		)

		expect(rules).toHaveLength(1)
		expect(rules[0].condition).toEqual({
			regexFilter: "^http://localhost:1455/openai-oauth/installed(\\?.*)?$",
			resourceTypes: ["main_frame", "sub_frame"],
		})
		expect(rules[0].action.redirect.extensionPath).toBe("/src/installed.html")
	})
})
