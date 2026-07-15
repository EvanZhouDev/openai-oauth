/**
 * Installs undici EnvHttpProxyAgent as the global fetch dispatcher when
 * HTTP(S)_PROXY env vars are set. Works across Node versions that lack
 * NODE_USE_ENV_PROXY, and complements it where available.
 *
 * Loaded via: node --import /app/docker/proxy-bootstrap.mjs …
 */
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { EnvHttpProxyAgent, setGlobalDispatcher } = require(
	join(dirname(fileURLToPath(import.meta.url)), "node_modules", "undici"),
)

const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy
const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy
const noProxy = process.env.NO_PROXY || process.env.no_proxy

if (httpProxy || httpsProxy) {
	setGlobalDispatcher(new EnvHttpProxyAgent())
	const summary = [
		httpProxy && `HTTP_PROXY=${httpProxy}`,
		httpsProxy && `HTTPS_PROXY=${httpsProxy}`,
		noProxy && `NO_PROXY=${noProxy}`,
	]
		.filter(Boolean)
		.join(", ")
	console.error(`[proxy] Enabled outbound proxy (${summary})`)
}
