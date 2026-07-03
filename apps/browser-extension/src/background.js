const callbackHost = "localhost"
const callbackPort = "1455"
const callbackPath = "/auth/callback"
const statePrefix = "oo2_"
const relayStoragePrefix = "relay:"

const randomId = () => {
	const bytes = new Uint8Array(16)
	crypto.getRandomValues(bytes)
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	)
}

const decodeBase64Url = (value) => {
	const base64 = value.replaceAll("-", "+").replaceAll("_", "/")
	const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
	const binary = atob(padded)
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
	return new TextDecoder().decode(bytes)
}

const decodeRelayState = (state) => {
	if (!state?.startsWith(statePrefix)) {
		return null
	}

	try {
		const payload = JSON.parse(decodeBase64Url(state.slice(statePrefix.length)))
		if (
			payload?.type !== "openai-oauth-callback" ||
			payload.version !== 1 ||
			typeof payload.callbackUrl !== "string"
		) {
			return null
		}
		return payload
	} catch {
		return null
	}
}

const isAllowedCallbackUrl = (url) => {
	if (url.protocol === "https:") {
		return true
	}

	return (
		url.protocol === "http:" &&
		(url.hostname === "localhost" || url.hostname === "127.0.0.1")
	)
}

const createRelayUrl = (sourceUrl, callbackUrl) => {
	const target = new URL(callbackUrl)
	if (!isAllowedCallbackUrl(target)) {
		return null
	}

	if (
		target.origin === sourceUrl.origin &&
		target.pathname === sourceUrl.pathname
	) {
		return null
	}

	for (const [key, value] of sourceUrl.searchParams) {
		target.searchParams.append(key, value)
	}

	return target.toString()
}

const createCancelUrl = (sourceUrl, callbackUrl) => {
	const target = new URL(callbackUrl)
	if (!isAllowedCallbackUrl(target)) {
		return null
	}

	const state = sourceUrl.searchParams.get("state")
	target.searchParams.set("error", "access_denied")
	target.searchParams.set("error_description", "Sign-in cancelled")
	if (state) {
		target.searchParams.set("state", state)
	}

	return target.toString()
}

const handleNavigation = async (details) => {
	if (details.frameId !== 0 || details.tabId < 0) {
		return
	}

	const sourceUrl = new URL(details.url)
	if (
		sourceUrl.protocol !== "http:" ||
		sourceUrl.hostname !== callbackHost ||
		sourceUrl.port !== callbackPort ||
		sourceUrl.pathname !== callbackPath
	) {
		return
	}

	const relayState = decodeRelayState(sourceUrl.searchParams.get("state"))
	if (!relayState) {
		return
	}

	const relayUrl = createRelayUrl(sourceUrl, relayState.callbackUrl)
	const cancelUrl = createCancelUrl(sourceUrl, relayState.callbackUrl)
	if (!relayUrl || !cancelUrl) {
		return
	}

	const id = randomId()
	await chrome.storage.session.set({
		[`${relayStoragePrefix}${id}`]: {
			relayUrl,
			cancelUrl,
			callbackHost: new URL(relayState.callbackUrl).host,
		},
	})
	await chrome.tabs.update(details.tabId, {
		url: chrome.runtime.getURL(`src/confirm.html?id=${id}`),
	})
}

chrome.webNavigation.onBeforeNavigate.addListener(handleNavigation, {
	url: [
		{
			// Chrome host permissions are origin/port scoped, not path scoped.
			// This event filter is the narrow runtime gate for the OAuth callback.
			schemes: ["http"],
			hostEquals: callbackHost,
			ports: [Number(callbackPort)],
			pathEquals: callbackPath,
		},
	],
})
