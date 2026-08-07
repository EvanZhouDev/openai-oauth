import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	// Hosted dev environments (Replit, Codespaces, Gitpod) proxy from their own
	// domain, which Next blocks by default.
	allowedDevOrigins: [
		"127.0.0.1",
		"localhost",
		"*.replit.dev",
		"*.repl.co",
		"*.app.github.dev",
		"*.gitpod.io",
	],
	transpilePackages: [
		"@openai-oauth/core",
		"@openai-oauth/react",
		"@openai-oauth/web",
	],
}

export default nextConfig
