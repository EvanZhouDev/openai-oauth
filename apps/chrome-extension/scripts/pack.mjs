import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"))
const outputDirectory = join(root, "dist-pack")
const output = join(
	outputDirectory,
	`sign-in-with-chatgpt-${manifest.version}.zip`,
)

rmSync(outputDirectory, { force: true, recursive: true })
mkdirSync(outputDirectory, { recursive: true })

const result = spawnSync(
	"zip",
	["-r", "-X", output, ".", "-x", "*/.DS_Store"],
	{
		cwd: join(root, "dist"),
		stdio: "inherit",
	},
)
if (result.status !== 0) {
	process.exit(result.status ?? 1)
}
