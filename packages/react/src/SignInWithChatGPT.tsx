import type {
	ButtonHTMLAttributes,
	CSSProperties,
	MouseEvent,
	MouseEventHandler,
} from "react"
import { useState } from "react"
import { SignInWithChatGPTExtensionScreen } from "./SignInWithChatGPTExtensionScreen.js"
import {
	type UseSignInWithChatGPTOptions,
	useSignInWithChatGPT,
} from "./useSignInWithChatGPT.js"

export type SignInWithChatGPTProps = Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	"onError"
> &
	UseSignInWithChatGPTOptions & {
		loadingLabel?: string
		redirectingLabel?: string
		signedInLabel?: string
		hideAttribution?: boolean
		hideWhenSignedIn?: boolean
		showLogo?: boolean
	}

const containerStyle: CSSProperties = {
	alignItems: "center",
	display: "inline-flex",
	flexDirection: "column",
	gap: 5,
}

const buttonStyle: CSSProperties = {
	alignItems: "center",
	background: "#ffffff",
	border: "1px solid #d9d9d9",
	borderRadius: 9999,
	color: "#111111",
	cursor: "pointer",
	display: "inline-flex",
	fontFamily:
		'-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
	fontSize: 15,
	fontWeight: 450,
	gap: 12,
	justifyContent: "center",
	lineHeight: 1.2,
	minHeight: 52,
	minWidth: 224,
	padding: "14px 22px",
	whiteSpace: "nowrap",
}

const logoStyle: CSSProperties = {
	display: "block",
	flex: "0 0 auto",
	height: 22,
	width: 22,
}

const attributionStyle: CSSProperties = {
	color: "#8f8f8f",
	fontFamily:
		'-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
	fontSize: 10,
	fontWeight: 400,
	lineHeight: 1.2,
	textDecoration: "underline",
	textDecorationColor: "currentColor",
	textUnderlineOffset: 2,
}

const OpenAILogo = () => (
	<svg
		aria-hidden="true"
		fill="none"
		focusable="false"
		style={logoStyle}
		viewBox="0 0 5086 5021"
		xmlns="http://www.w3.org/2000/svg"
	>
		<title>OpenAI</title>
		<path
			d="M1947.45 1832.08V1357.04C1947.45 1317.03 1962.45 1287.01 1997.43 1267.05L2952.46 717.024C3082.47 642.035 3237.47 607.018 3397.45 607.018C3997.47 607.018 4377.48 1072.05 4377.48 1567.07C4377.48 1602.06 4377.48 1642.06 4372.46 1682.07L3382.45 1102.04C3322.46 1067.03 3262.46 1067.03 3202.45 1102.04L1947.45 1832.08ZM4177.46 3682.19V2547.08C4177.46 2477.08 4147.44 2427.07 4087.45 2392.08L2832.45 1662.05L3242.46 1427.01C3277.44 1407.02 3307.47 1407.02 3342.45 1427.01L4297.47 1977.03C4572.51 2137.05 4757.46 2477.08 4757.46 2807.06C4757.46 3187.06 4532.51 3537.1 4177.46 3682.12V3682.19ZM1652.43 2682.13L1242.42 2442.13C1207.44 2422.14 1192.44 2392.11 1192.44 2352.14V1252.09C1192.44 717.057 1602.45 312.018 2157.48 312.018C2367.47 312.018 2562.43 382.019 2727.5 507.022L1742.48 1077.07C1682.49 1112.05 1652.49 1162.07 1652.49 1232.1V2682.16L1652.43 2682.13ZM2534.98 3192.15L1947.38 2862.13V2162.13L2534.91 1832.11L3122.41 2162.13V2862.13L2534.98 3192.15ZM2912.45 4712.24C2702.43 4712.24 2507.46 4642.21 2342.43 4517.24L3327.42 3947.16C3387.41 3912.17 3417.43 3862.19 3417.43 3792.16V2342.07L3832.46 2582.06C3867.45 2602.05 3882.44 2632.08 3882.44 2672.08V3772.14C3882.44 4307.14 3467.41 4712.24 2912.45 4712.24ZM1727.41 3597.19L772.388 3047.16C497.352 2887.14 312.365 2547.15 312.365 2217.13C312.365 1832.11 542.409 1487.1 897.386 1342.07V2482.13C897.386 2552.17 927.38 2602.15 987.369 2637.13L2237.42 3362.15L1827.41 3597.19C1792.42 3617.17 1762.4 3617.17 1727.41 3597.19ZM1672.45 4417.24C1107.44 4417.24 692.414 3992.18 692.414 3467.16C692.414 3427.16 697.434 3387.15 702.422 3347.15L1687.41 3917.19C1747.42 3952.19 1807.42 3952.19 1867.41 3917.19L3122.41 3192.18V3667.22C3122.41 3707.22 3107.42 3737.22 3072.43 3757.21L2117.41 4307.23C1987.39 4382.22 1832.39 4417.24 1672.38 4417.24H1672.45ZM2912.45 5012.23C3517.46 5012.23 4022.44 4582.22 4137.49 4012.17C4697.48 3867.15 5057.51 3342.13 5057.51 2807.13C5057.51 2457.09 4907.5 2117.1 4637.49 1872.05C4662.49 1767.06 4677.52 1662.05 4677.52 1557.1C4677.52 842.06 4097.49 306.997 3427.48 306.997C3292.5 306.997 3162.48 326.951 3032.46 371.977C2807.44 151.966 2497.45 11.9648 2157.44 11.9648C1552.44 11.9648 1047.46 441.978 932.434 1012.02C372.419 1157.05 12.4219 1682.03 12.4219 2217.06C12.4219 2567.13 162.394 2907.13 432.408 3152.14C407.402 3257.13 392.405 3362.15 392.405 3467.13C392.405 4182.13 972.404 4717.2 1642.45 4717.2C1777.43 4717.2 1907.41 4697.24 2037.43 4652.22C2262.39 4872.23 2572.41 5012.23 2912.45 5012.23Z"
			fill="currentColor"
		/>
	</svg>
)

export const SignInWithChatGPT = ({
	callbackPath,
	clientId,
	codeVerifier,
	sessionStore,
	extraParams,
	fetch,
	idTokenAddOrganizations,
	issuer,
	now,
	onSuccess,
	onError,
	onStateChange,
	openMode,
	redirectUri,
	scope,
	simplifiedFlow,
	state,
	tokenUrl,
	loadingLabel = "Connecting...",
	redirectingLabel = "Signing in...",
	signedInLabel = "Disconnect ChatGPT",
	hideAttribution = false,
	hideWhenSignedIn = false,
	showLogo = true,
	children = "Sign in with ChatGPT",
	disabled,
	onClick,
	onMouseEnter,
	onMouseLeave,
	style,
	type = "button",
	...props
}: SignInWithChatGPTProps) => {
	const [isHovered, setIsHovered] = useState(false)
	const login = useSignInWithChatGPT({
		callbackPath,
		clientId,
		codeVerifier,
		sessionStore,
		extraParams,
		fetch,
		idTokenAddOrganizations,
		issuer,
		now,
		onSuccess,
		onError,
		onStateChange,
		openMode,
		redirectUri,
		scope,
		simplifiedFlow,
		state,
		tokenUrl,
	})
	const isBusy = login.status === "starting" || login.status === "redirecting"
	const isSignedIn = login.status === "signed-in"
	const needsExtension = login.status === "needs-extension"

	const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
		onClick?.(event)
		if (event.defaultPrevented) {
			return
		}
		if (isSignedIn) {
			void login.logout()
			return
		}
		void login.login()
	}

	const handleMouseEnter: MouseEventHandler<HTMLButtonElement> = (event) => {
		setIsHovered(true)
		onMouseEnter?.(event)
	}

	const handleMouseLeave: MouseEventHandler<HTMLButtonElement> = (event) => {
		setIsHovered(false)
		onMouseLeave?.(event)
	}

	if (hideWhenSignedIn && isSignedIn) {
		return null
	}

	const extensionScreen = needsExtension ? (
		<SignInWithChatGPTExtensionScreen
			installUrl={login.installUrl}
			onCancel={login.reset}
			onContinue={login.login}
		/>
	) : null

	const button = (
		<button
			{...props}
			type={type}
			disabled={disabled || isBusy}
			onClick={handleClick}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
			style={{
				...buttonStyle,
				background: isHovered && !disabled && !isBusy ? "#f9f9f9" : "#ffffff",
				...style,
			}}
		>
			{showLogo ? <OpenAILogo /> : null}
			<span>
				{login.status === "redirecting"
					? redirectingLabel
					: isBusy
						? loadingLabel
						: isSignedIn
							? signedInLabel
							: children}
			</span>
		</button>
	)

	if (hideAttribution) {
		return (
			<>
				{button}
				{extensionScreen}
			</>
		)
	}

	return (
		<span style={containerStyle}>
			{button}
			<a
				href="https://github.com/EvanZhouDev/openai-oauth"
				rel="noreferrer"
				style={attributionStyle}
				target="_blank"
			>
				Powered by OpenAI OAuth
			</a>
			{extensionScreen}
		</span>
	)
}
