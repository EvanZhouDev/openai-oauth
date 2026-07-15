import {
	type CompleteLoginOptions,
	logout as clearLogin,
	completeLogin,
	createSessionStore,
	refreshSession,
	type StartLoginOptions,
	startLogin,
} from "@openai-oauth/web"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
	OpenAIOAuthSession,
	SessionStore,
	SignInWithChatGPTError,
	SignInWithChatGPTState,
} from "./types.js"

export type SignInWithChatGPTOpenMode = "redirect" | "popup"

export type UseSignInWithChatGPTOptions = Omit<StartLoginOptions, "returnTo"> &
	Pick<CompleteLoginOptions, "fetch" | "now" | "tokenUrl"> & {
		sessionStore?: SessionStore
		onStateChange?: (state: SignInWithChatGPTState) => void
		onSuccess?: (session: OpenAIOAuthSession) => void
		onError?: (error: SignInWithChatGPTError) => void
	}

export type UseSignInWithChatGPTReturn = SignInWithChatGPTState & {
	isSignedIn: boolean
	login: () => Promise<void>
	logout: () => Promise<void>
	refresh: () => Promise<OpenAIOAuthSession | null>
	reset: () => Promise<void>
}

const popupMessageType = "openai-oauth:signed-in"

const checkingState: SignInWithChatGPTState = {
	status: "checking",
	session: null,
	error: null,
}

const signedOutState: SignInWithChatGPTState = {
	status: "signed-out",
	session: null,
	error: null,
}

const needsExtensionState = (installUrl: string): SignInWithChatGPTState => ({
	status: "needs-extension",
	installUrl,
	session: null,
	error: null,
})

const isBrowser = (): boolean => typeof window !== "undefined"

const toLoginError = (
	error: unknown,
	code: SignInWithChatGPTError["code"] = "request-failed",
): SignInWithChatGPTError => ({
	code,
	message:
		error instanceof Error ? error.message : "Sign in with ChatGPT failed.",
	cause: error,
})

const notifyOpener = (): void => {
	if (window.opener && window.opener !== window) {
		window.opener.postMessage(
			{ type: popupMessageType },
			window.location.origin,
		)
		window.setTimeout(() => window.close(), 50)
	}
}

const useLatest = <T>(value: T) => {
	const ref = useRef(value)
	ref.current = value
	return ref
}

export const useSignInWithChatGPT = (
	options: UseSignInWithChatGPTOptions = {},
): UseSignInWithChatGPTReturn => {
	const {
		callbackPath,
		clientId,
		codeVerifier,
		sessionStore: providedSessionStore,
		extraParams,
		fetch: fetchImpl,
		idTokenAddOrganizations,
		issuer,
		now,
		onSuccess,
		onError,
		onStateChange,
		openMode = "redirect",
		redirectUri,
		scope,
		simplifiedFlow,
		state: configuredState,
		tokenUrl,
	} = options
	const onSuccessRef = useLatest(onSuccess)
	const onErrorRef = useLatest(onError)
	const onStateChangeRef = useLatest(onStateChange)
	const defaultStore = useMemo(() => createSessionStore(), [])
	const sessionStore = providedSessionStore ?? defaultStore
	const [state, setState] = useState<SignInWithChatGPTState>(checkingState)

	const signedInState = useCallback(
		(session: OpenAIOAuthSession): SignInWithChatGPTState => ({
			status: "signed-in",
			session,
			error: null,
		}),
		[],
	)

	const setLoginState = useCallback(
		(next: SignInWithChatGPTState) => {
			setState(next)
			onStateChangeRef.current?.(next)
		},
		[onStateChangeRef],
	)

	const fail = useCallback(
		(error: unknown, code?: SignInWithChatGPTError["code"]) => {
			const loginError = toLoginError(error, code)
			setLoginState({
				status: "error",
				session: null,
				error: loginError,
			})
			onErrorRef.current?.(loginError)
		},
		[onErrorRef, setLoginState],
	)

	const loadStoredSession = useCallback(async () => {
		const session = await sessionStore.get()
		if (!session) {
			setLoginState(signedOutState)
			return
		}
		const next = signedInState(session)
		setLoginState(next)
		onSuccessRef.current?.(session)
	}, [sessionStore, onSuccessRef, setLoginState, signedInState])

	const completeCallback = useCallback(async (): Promise<boolean> => {
		if (!isBrowser()) {
			return false
		}

		const session = await completeLogin({
			clientId,
			fetch: fetchImpl,
			issuer,
			now,
			sessionStore,
			tokenUrl,
		})
		if (!session) {
			return false
		}

		const next = signedInState(session)
		setLoginState(next)
		onSuccessRef.current?.(session)
		notifyOpener()
		return true
	}, [
		clientId,
		fetchImpl,
		issuer,
		now,
		sessionStore,
		tokenUrl,
		onSuccessRef,
		setLoginState,
		signedInState,
	])

	useEffect(() => {
		if (!isBrowser()) {
			setLoginState(signedOutState)
			return
		}

		let current = true
		void (async () => {
			let completed = false
			try {
				completed = await completeCallback()
			} catch (error) {
				if (current) {
					fail(error, "invalid-callback")
				}
				return
			}
			if (!current || completed) {
				return
			}
			try {
				await loadStoredSession()
			} catch (error) {
				if (current) {
					fail(error)
				}
			}
		})()

		return () => {
			current = false
		}
	}, [completeCallback, fail, loadStoredSession, setLoginState])

	useEffect(() => {
		if (!isBrowser()) {
			return
		}

		const onMessage = (event: MessageEvent) => {
			if (
				event.origin === window.location.origin &&
				typeof event.data === "object" &&
				event.data !== null &&
				"type" in event.data &&
				event.data.type === popupMessageType
			) {
				void loadStoredSession()
			}
		}

		window.addEventListener("message", onMessage)
		return () => window.removeEventListener("message", onMessage)
	}, [loadStoredSession])

	const login = useCallback(async () => {
		if (!isBrowser()) {
			fail(new Error("Sign in with ChatGPT can only start in a browser."))
			return
		}

		try {
			if (state.status !== "needs-extension") {
				setLoginState({
					status: "starting",
					session: null,
					error: null,
				})
			}

			const result = await startLogin({
				callbackPath,
				clientId,
				codeVerifier,
				extraParams,
				idTokenAddOrganizations,
				issuer,
				openMode,
				redirectUri,
				scope,
				simplifiedFlow,
				state: configuredState,
			})
			if (result.status === "needs-extension") {
				setLoginState(needsExtensionState(result.installUrl))
				return
			}

			setLoginState({
				status: "redirecting",
				session: null,
				error: null,
			})
		} catch (error) {
			fail(
				error,
				error instanceof Error &&
					error.message === "The ChatGPT login popup was blocked."
					? "popup-blocked"
					: undefined,
			)
		}
	}, [
		callbackPath,
		clientId,
		codeVerifier,
		configuredState,
		extraParams,
		fail,
		idTokenAddOrganizations,
		issuer,
		openMode,
		redirectUri,
		scope,
		setLoginState,
		simplifiedFlow,
		state.status,
	])

	const logout = useCallback(async () => {
		await clearLogin({ sessionStore })
		setLoginState(signedOutState)
	}, [sessionStore, setLoginState])

	const refresh = useCallback(async () => {
		try {
			const session = state.session ?? (await sessionStore.get())
			if (!session?.refreshToken) {
				fail(new Error("No refresh token is available."), "not-authenticated")
				return null
			}
			const refreshed = await refreshSession(
				{
					refreshToken: session.refreshToken,
				},
				{
					clientId,
					fetch: fetchImpl,
					issuer,
					now,
					tokenUrl,
				},
			)
			const nextSession =
				session.isFedRamp && !refreshed.isFedRamp
					? { ...refreshed, isFedRamp: true }
					: refreshed
			await sessionStore.set(nextSession)
			const next = signedInState(nextSession)
			setLoginState(next)
			onSuccessRef.current?.(nextSession)
			return nextSession
		} catch (error) {
			fail(error)
			return null
		}
	}, [
		clientId,
		fail,
		fetchImpl,
		issuer,
		now,
		onSuccessRef,
		sessionStore,
		setLoginState,
		signedInState,
		state.session,
		tokenUrl,
	])

	const reset = useCallback(async () => {
		await clearLogin({ sessionStore })
		setLoginState(signedOutState)
	}, [sessionStore, setLoginState])

	return {
		...state,
		isSignedIn: state.status === "signed-in",
		login,
		logout,
		refresh,
		reset,
	}
}
