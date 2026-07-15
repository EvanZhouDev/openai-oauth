import { createHash } from "node:crypto"
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const extensionId = "odbgboachaefbbbdiffcefhpkekhfcna"
const keyEnvName = "OPENAI_OAUTH_BROWSER_EXTENSION_KEY"
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const shared = join(root, "../../shared/browser-extension")
const isDev = process.argv.includes("--dev")
const distName = isDev ? "dist-dev" : "dist"
const dist = join(root, distName)

const copyFile = (from, to) => {
	mkdirSync(dirname(to), { recursive: true })
	cpSync(from, to)
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))

const normalizePublicKey = (key) => {
	const trimmed = key.trim()
	const pemMatch = trimmed.match(
		/-----BEGIN PUBLIC KEY-----\s*([\s\S]+?)\s*-----END PUBLIC KEY-----/,
	)
	const base64 = (pemMatch?.[1] ?? trimmed).replace(/\s+/g, "")
	if (!base64) {
		throw new Error("Chrome Web Store public key is empty.")
	}
	return base64
}

const extensionIdFromKey = (key) => {
	const digest = createHash("sha256")
		.update(Buffer.from(normalizePublicKey(key), "base64"))
		.digest()
	return [...digest.subarray(0, 16)]
		.map(
			(byte) =>
				String.fromCharCode("a".charCodeAt(0) + (byte >> 4)) +
				String.fromCharCode("a".charCodeAt(0) + (byte & 15)),
		)
		.join("")
}

rmSync(dist, { force: true, recursive: true })
mkdirSync(dist, { recursive: true })

const manifest = readJson(join(root, "manifest.json"))
if (isDev) {
	const key = process.env[keyEnvName]
	if (!key) {
		throw new Error(
			`Dev builds require the Chrome Web Store public key. Run with ${keyEnvName}=...`,
		)
	}
	const idFromKey = extensionIdFromKey(key)
	if (idFromKey !== extensionId) {
		throw new Error(
			`Chrome Web Store public key maps to ${idFromKey}, expected ${extensionId}.`,
		)
	}
	manifest.key = normalizePublicKey(key)
}

writeFileSync(
	join(dist, "manifest.json"),
	`${JSON.stringify(manifest, null, "\t")}\n`,
)
copyFile(join(root, "../../LICENSE"), join(dist, "LICENSE"))
copyFile(join(root, "../../NOTICE"), join(dist, "NOTICE"))
copyFile(
	join(root, "rules/openai-oauth-callback.json"),
	join(dist, "rules/openai-oauth-callback.json"),
)
copyFile(join(shared, "confirm.html"), join(dist, "src/confirm.html"))
copyFile(join(shared, "confirm.js"), join(dist, "src/confirm.js"))
copyFile(join(root, "src/installed.json"), join(dist, "src/installed.json"))
cpSync(join(shared, "assets"), join(dist, "src/assets"), { recursive: true })

console.log(
	isDev
		? `Built dev extension at ${distName} with Chrome Web Store ID ${extensionId}.`
		: `Built store extension at ${distName}.`,
)
