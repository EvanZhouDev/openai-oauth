const relayStoragePrefix = "relay:"

const params = new URLSearchParams(window.location.search)
const id = params.get("id")
const title = document.querySelector("#title")
const message = document.querySelector("#message")
const continueButton = document.querySelector("#continue")
const cancelButton = document.querySelector("#cancel")
const actions = document.querySelector(".actions")
const returnDelayMs = 900

const showError = () => {
	message.classList.add("error")
	message.textContent =
		"This sign-in request expired. Start again from the app."
	actions.hidden = true
}

if (!id) {
	showError()
} else {
	const storageKey = `${relayStoragePrefix}${id}`
	const stored = await chrome.storage.session.get(storageKey)
	const relay = stored[storageKey]

	if (!relay?.relayUrl || !relay?.cancelUrl || !relay?.callbackHost) {
		showError()
	} else {
		message.innerHTML = ""
		message.append(
			`Continue to ${relay.callbackHost}`,
			document.createElement("br"),
			"with ChatGPT.",
		)
		continueButton.disabled = false
		cancelButton.disabled = false
		continueButton.addEventListener("click", async () => {
			continueButton.disabled = true
			cancelButton.disabled = true
			await chrome.storage.session.remove(storageKey)
			window.location.href = relay.relayUrl
		})
		cancelButton.addEventListener("click", async () => {
			continueButton.disabled = true
			cancelButton.disabled = true
			await chrome.storage.session.remove(storageKey)
			title.textContent = "Sign-in cancelled"
			message.textContent = `Returning to ${relay.callbackHost}...`
			actions.hidden = true
			window.setTimeout(() => {
				window.location.href = relay.cancelUrl
			}, returnDelayMs)
		})
	}
}
