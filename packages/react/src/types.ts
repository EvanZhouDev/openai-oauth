import type { OpenAIOAuthSession, SessionStore } from "@openai-oauth/core"

export type { OpenAIOAuthSession, SessionStore }

export type SignInWithChatGPTError = {
	code:
		| "invalid-callback"
		| "popup-blocked"
		| "request-failed"
		| "not-authenticated"
	message: string
	cause?: unknown
}

export type SignInWithChatGPTState =
	| {
			status: "checking"
			session: null
			error: null
	  }
	| {
			status: "signed-out"
			session: null
			error: null
	  }
	| {
			status: "starting"
			session: null
			error: null
	  }
	| {
			status: "needs-extension"
			installUrl: string
			session: null
			error: null
	  }
	| {
			status: "redirecting"
			session: null
			error: null
	  }
	| {
			status: "signed-in"
			session: OpenAIOAuthSession
			error: null
	  }
	| {
			status: "error"
			session: null
			error: SignInWithChatGPTError
	  }
