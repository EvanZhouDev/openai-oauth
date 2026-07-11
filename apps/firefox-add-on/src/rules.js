export const callbackRuleId = 1001

export const createCallbackRule = (confirmUrl) => ({
	id: callbackRuleId,
	priority: 1,
	action: {
		type: "redirect",
		redirect: {
			regexSubstitution: `${confirmUrl}#\\0`,
		},
	},
	condition: {
		regexFilter: "^http://localhost:1455/auth/callback(\\?.*)?$",
		resourceTypes: ["main_frame"],
	},
})
