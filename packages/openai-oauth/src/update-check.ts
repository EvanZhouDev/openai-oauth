const REGISTRY_URL = "https://registry.npmjs.org/openai-oauth/latest"

type RegistryPackageResponse = {
	version?: unknown
}

type UpdateCheckDependencies = {
	fetchImpl?: typeof fetch
	onWarning?: (message: string) => void
}

const normalizeVersion = (value: string | undefined): string | undefined => {
	if (typeof value !== "string") {
		return undefined
	}

	const match = value.trim().match(/^\d+\.\d+\.\d+$/)
	return match?.[0]
}

const compareSemver = (left: string, right: string): number => {
	const leftParts = left.split(".").map(Number)
	const rightParts = right.split(".").map(Number)

	for (let index = 0; index < 3; index += 1) {
		const leftPart = leftParts[index] ?? 0
		const rightPart = rightParts[index] ?? 0
		if (leftPart < rightPart) {
			return -1
		}
		if (leftPart > rightPart) {
			return 1
		}
	}

	return 0
}

const fetchLatestVersion = async (
	fetchImpl: typeof fetch,
): Promise<string | undefined> => {
	try {
		const response = await fetchImpl(REGISTRY_URL, {
			headers: {
				accept: "application/json",
			},
		})

		if (!response.ok) {
			return undefined
		}

		const parsed = (await response.json()) as RegistryPackageResponse
		return typeof parsed.version === "string"
			? normalizeVersion(parsed.version)
			: undefined
	} catch {
		return undefined
	}
}

export const checkForOpenAIOAuthUpdates = async (
	currentVersion: string,
	dependencies: UpdateCheckDependencies = {},
): Promise<void> => {
	const normalizedCurrentVersion = normalizeVersion(currentVersion)
	if (normalizedCurrentVersion == null) {
		return
	}

	const latestVersion = await fetchLatestVersion(
		dependencies.fetchImpl ?? globalThis.fetch,
	)
	if (latestVersion == null) {
		return
	}

	if (compareSemver(normalizedCurrentVersion, latestVersion) >= 0) {
		return
	}

	dependencies.onWarning?.(
		`A newer version of openai-oauth is available: ${normalizedCurrentVersion} -> ${latestVersion}.\nRun \`npx openai-oauth@latest\` to use the newest version.`,
	)
}

export { compareSemver, normalizeVersion }
