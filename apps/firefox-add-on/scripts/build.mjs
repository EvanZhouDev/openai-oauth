import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const shared = join(root, "../../shared/browser-extension")
const dist = join(root, "dist")

const copyFile = (from, to) => {
	mkdirSync(dirname(to), { recursive: true })
	cpSync(from, to)
}

rmSync(dist, { force: true, recursive: true })
mkdirSync(dist, { recursive: true })

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"))
writeFileSync(
	join(dist, "manifest.json"),
	`${JSON.stringify(manifest, null, "\t")}\n`,
)
copyFile(join(root, "../../LICENSE"), join(dist, "LICENSE"))
copyFile(join(root, "../../NOTICE"), join(dist, "NOTICE"))
copyFile(
	join(root, "rules/openai-oauth-detection.json"),
	join(dist, "rules/openai-oauth-detection.json"),
)
copyFile(join(root, "src/background.js"), join(dist, "src/background.js"))
copyFile(join(root, "src/rules.js"), join(dist, "src/rules.js"))
copyFile(join(root, "src/installed.html"), join(dist, "src/installed.html"))
copyFile(join(root, "src/installed.js"), join(dist, "src/installed.js"))
copyFile(join(shared, "confirm.html"), join(dist, "src/confirm.html"))
copyFile(join(shared, "confirm.js"), join(dist, "src/confirm.js"))
cpSync(join(shared, "assets"), join(dist, "src/assets"), { recursive: true })

console.log("Built Firefox add-on at dist.")
