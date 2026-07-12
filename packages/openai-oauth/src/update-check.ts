const registryUrl = "https://registry.npmjs.org/openai-oauth/latest"

type RegistryPackageResponse = {
	version?: unknown
}

type UpdateCheckDependencies = {
	fetchImpl?: typeof fetch
	onWarning?: (message: string) => void
	timeoutMs?: number
}

const normalizeVersion = (value: string | undefined): string | undefined => {
	if (typeof value !== "string") {
		return undefined
	}

	const match = value.trim().match(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
	return match?.[0]
}

const compareSemver = (left: string, right: string): number => {
	const [leftCore = "", leftPrerelease] = left.split("-", 2)
	const [rightCore = "", rightPrerelease] = right.split("-", 2)
	const leftParts = leftCore.split(".").map(Number)
	const rightParts = rightCore.split(".").map(Number)

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

	if (leftPrerelease == null) return rightPrerelease == null ? 0 : 1
	if (rightPrerelease == null) return -1

	const leftIdentifiers = leftPrerelease.split(".")
	const rightIdentifiers = rightPrerelease.split(".")
	const length = Math.max(leftIdentifiers.length, rightIdentifiers.length)
	for (let index = 0; index < length; index += 1) {
		const leftIdentifier = leftIdentifiers[index]
		const rightIdentifier = rightIdentifiers[index]
		if (leftIdentifier == null) return -1
		if (rightIdentifier == null) return 1
		if (leftIdentifier === rightIdentifier) continue

		const leftNumber = /^\d+$/.test(leftIdentifier)
			? Number(leftIdentifier)
			: undefined
		const rightNumber = /^\d+$/.test(rightIdentifier)
			? Number(rightIdentifier)
			: undefined
		if (leftNumber != null && rightNumber != null) {
			return leftNumber < rightNumber ? -1 : 1
		}
		if (leftNumber != null) return -1
		if (rightNumber != null) return 1
		return leftIdentifier < rightIdentifier ? -1 : 1
	}

	return 0
}

const fetchLatestVersion = async (
	fetchImpl: typeof fetch,
	signal?: AbortSignal,
): Promise<string | undefined> => {
	try {
		const requestInit: RequestInit = {
			headers: {
				accept: "application/json",
			},
		}
		if (signal) {
			requestInit.signal = signal
		}

		const response = await fetchImpl(registryUrl, requestInit)

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
	const abortController = new AbortController()
	const timeout = setTimeout(() => {
		abortController.abort()
	}, dependencies.timeoutMs ?? 1500)
	if (typeof timeout === "object" && "unref" in timeout) {
		timeout.unref()
	}

	const latestVersion = await fetchLatestVersion(
		dependencies.fetchImpl ?? globalThis.fetch,
		abortController.signal,
	)
	clearTimeout(timeout)
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
