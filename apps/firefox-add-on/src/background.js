import { callbackRuleId, createCallbackRule } from "./rules.js"

const installCallbackRule = async () => {
	const confirmUrl = browser.runtime.getURL("src/confirm.html")
	await browser.declarativeNetRequest.updateDynamicRules({
		removeRuleIds: [callbackRuleId],
		addRules: [createCallbackRule(confirmUrl)],
	})
}

installCallbackRule().catch((error) => {
	console.error("Failed to install the OpenAI OAuth callback rule.", error)
})
