import { expect, test } from "vitest"
import packageJson from "../package.json" with { type: "json" }
import { packageVersion } from "../src/version.js"

test("package version constant matches package.json", () => {
	expect(packageVersion).toBe(packageJson.version)
})
