const marker = {
	type: "openai-oauth:browser-extension-installed",
	name: "sign-in-with-chatgpt",
	protocol: "openai-oauth-browser-extension",
	protocolVersion: 1,
}

if (window.parent !== window) {
	window.parent.postMessage(marker, "*")
} else if (window.opener) {
	window.opener.postMessage(marker, "*")
	window.close()
}
