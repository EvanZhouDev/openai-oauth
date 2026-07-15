const title = document.querySelector("#title")
const message = document.querySelector("#message")
const continueButton = document.querySelector("#continue")
const cancelButton = document.querySelector("#cancel")
const actions = document.querySelector(".actions")
const returnDelayMs = 900
const statePrefix = "oo2_"

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

const getSourceUrl = () => {
	const source = window.location.hash.startsWith("#")
		? window.location.hash.slice(1)
		: ""
	window.history.replaceState(null, "", window.location.pathname)
	if (!source) {
		return null
	}

	try {
		return new URL(source)
	} catch {
		try {
			return new URL(decodeURIComponent(source))
		} catch {
			return null
		}
	}
}

const showError = () => {
	message.classList.add("error")
	message.textContent =
		"This sign-in request expired. Start again from the app."
	actions.hidden = true
}

const sourceUrl = getSourceUrl()
const relayState = sourceUrl
	? decodeRelayState(sourceUrl.searchParams.get("state"))
	: null
const relayUrl =
	sourceUrl && relayState
		? createRelayUrl(sourceUrl, relayState.callbackUrl)
		: null
const cancelUrl =
	sourceUrl && relayState
		? createCancelUrl(sourceUrl, relayState.callbackUrl)
		: null
const callbackHost = relayState
	? new URL(relayState.callbackUrl).host
	: undefined

if (!sourceUrl || !relayState || !relayUrl || !cancelUrl || !callbackHost) {
	showError()
} else {
	message.innerHTML = ""
	message.append(
		`Continue to ${callbackHost}`,
		document.createElement("br"),
		"with ChatGPT.",
	)
	continueButton.disabled = false
	cancelButton.disabled = false
	continueButton.addEventListener("click", () => {
		continueButton.disabled = true
		cancelButton.disabled = true
		window.location.href = relayUrl
	})
	cancelButton.addEventListener("click", () => {
		continueButton.disabled = true
		cancelButton.disabled = true
		title.textContent = "Sign-in cancelled"
		message.textContent = `Returning to ${callbackHost}...`
		actions.hidden = true
		window.setTimeout(() => {
			window.location.href = cancelUrl
		}, returnDelayMs)
	})
}
