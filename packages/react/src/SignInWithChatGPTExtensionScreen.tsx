import { isBrowserExtensionInstalled } from "@openai-oauth/web"
import type { CSSProperties } from "react"
import { useEffect, useRef, useState } from "react"

export type SignInWithChatGPTExtensionScreenProps = {
	browserExtensionDetectionTimeoutMs?: number
	browserExtensionId?: string
	chromeWebStoreUrl?: string
	githubUrl?: string
	legalUrl?: string
	onCancel?: () => void
	onContinue: () => void | Promise<void>
	pollIntervalMs?: number
}

const defaultChromeWebStoreUrl = "https://chromewebstore.google.com/"
const defaultGithubUrl = "https://github.com/evanzhoudev/openai-oauth"
const defaultLegalUrl = "https://github.com/evanzhoudev/openai-oauth#legal"
const defaultPollIntervalMs = 500
const popupName = "openai-oauth-extension-install"
const popupWidth = 1350
const popupHeight = 760

const logoSrc =
	"data:image/svg+xml,%3Csvg%20width%3D%221412%22%20height%3D%221412%22%20viewBox%3D%220%200%201412%201412%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%0A%3Cstyle%3E%0A.mark%20%7B%20fill%3A%20%23111111%3B%20%7D%0A%40media%20(prefers-color-scheme%3A%20dark)%20%7B%0A%20%20.mark%20%7B%20fill%3A%20%23ffffff%3B%20%7D%0A%7D%0A%3C%2Fstyle%3E%0A%3Cg%20clip-path%3D%22url(%23clip0_36_7)%22%3E%0A%3Cpath%20class%3D%22mark%22%20d%3D%22M597.462%200.857699C673.717%20-4.5771%20755.535%2016.0618%20820.557%2055.7878C839.621%2067.4347%20853.532%2077.8804%20870.903%2091.7881C915.947%2083.6597%20962.083%2083.5966%201007.15%2091.601C1108.64%20109.677%201198.75%20167.436%201257.54%20252.101C1315.95%20336.355%201338.56%20440.326%201320.41%20541.218C1348.4%20575.095%201369.47%20609.408%201385.5%20650.519C1422.8%20746.143%201420.65%20852.641%201379.53%20946.681C1345.7%201023.88%201287.62%201087.95%201214.08%201129.17C1193.85%201140.47%201177.72%201147.33%201156.35%201155.65C1150.8%201167.38%201146.43%201180.08%201140.53%201192.52C1124.33%201226.23%201103.33%201257.42%201078.21%201285.12C1009.53%201360.77%20913.675%201406.14%20811.622%201411.3C797.103%201412.74%20770.195%201411.71%20755.535%201410.39C669.671%201402.64%20607.216%201373.41%20541.228%201320.14C498.371%201327.97%20454.491%201328.42%20411.479%201321.49C309.519%201305.16%20218.308%201248.8%20158.127%201164.91C95.5192%201077.93%2074.597%20975.652%2091.7694%20870.624C63.5815%20837.852%2041.1539%20800.536%2025.4414%20760.272C-11.0983%20663.999%20-8.18036%20557.204%2033.5617%20463.069C77.8418%20363.472%20155.004%20295.015%20255.809%20256.181C260.004%20248.164%20265.705%20231.947%20270.502%20221.837C286.044%20188.764%20306.234%20158.081%20330.46%20130.717C398.638%2053.6473%20494.725%206.91416%20597.462%200.857699ZM803.624%201297.49C879.882%201292.64%20946.234%201261.95%20997.071%201204.28C1015.09%201183.82%201029.9%201160.75%201041.02%201135.85C1047.58%201121.23%201051.8%201106.22%201056.86%201091.08C1067.19%201060.2%201088.78%201058.15%201115.61%201048.88C1125.47%201045.52%201135.09%201041.52%201144.43%201036.9C1243.91%20988.43%201304.38%20884.819%201297.64%20774.394C1294%20716.163%201271.8%20660.631%201234.27%20615.946C1223.26%20602.711%201208.28%20591.435%201203.34%20574.896C1197.16%20554.244%201207.83%20529.807%201210.67%20506.759C1221.87%20416.705%201187.69%20326.959%201119.41%20267.154C1064.95%20219.454%20993.758%20195.357%20921.517%20200.173C909.062%20200.932%20896.689%20202.63%20884.487%20205.252C858.307%20210.809%20839.711%20217.803%20816.524%20196.759C802.123%20183.693%20793.783%20175.007%20777.726%20163.451C738.141%20135.075%20691.432%20118.286%20642.835%20114.967C634.456%20114.329%20619.975%20113.369%20611.816%20114.357C536.156%20118.188%20468.827%20147.965%20417.756%20204.614C399.016%20225.371%20383.578%20248.884%20371.981%20274.328C368.409%20282.286%20365.23%20290.414%20362.455%20298.682C357.28%20314.179%20354.556%20330.003%20342.859%20342.026C330.473%20354.758%20314.132%20357.158%20297.998%20362.604C288.467%20365.803%20279.144%20369.592%20270.084%20373.948C170.322%20421.514%20108.992%20524.42%20114.64%20634.77C117.764%20693.592%20139.719%20749.855%20177.266%20795.249C188.357%20808.68%20203.749%20820.374%20208.712%20836.975C214.929%20857.779%20204.623%20882.481%20201.669%20905.586C190.625%20994.243%20223.634%201082.71%20290.065%201142.47C341.827%201188.92%20413.829%201216.16%20483.523%201212.31C496.702%201211.71%20509.821%201210.17%20522.783%201207.71C549.917%201202.44%20573.428%201193.61%20595.85%201215.61C654.397%201273.04%20720.807%201298.82%20803.624%201297.49Z%22%2F%3E%0A%3Cpath%20class%3D%22mark%22%20fill-rule%3D%22evenodd%22%20clip-rule%3D%22evenodd%22%20d%3D%22M528.104%20673.1C645.003%20673.1%20739.769%20767.837%20739.769%20884.701C739.769%201001.56%20645.003%201096.3%20528.104%201096.3C411.204%201096.3%20316.439%201001.56%20316.439%20884.701C316.439%20767.837%20411.204%20673.1%20528.104%20673.1ZM526.618%20785.954C472.886%20785.954%20429.327%20829.499%20429.327%20883.216C429.327%20936.932%20472.886%20980.478%20526.618%20980.478C580.351%20980.478%20623.91%20936.932%20623.91%20883.216C623.91%20829.499%20580.351%20785.954%20526.618%20785.954Z%22%2F%3E%0A%3Cpath%20class%3D%22mark%22%20d%3D%22M974.454%20335.733L1055.33%20416.583L688.769%20783.031L607.895%20702.182L974.454%20335.733Z%22%2F%3E%0A%3Cpath%20class%3D%22mark%22%20d%3D%22M820.585%20766.758L704.525%20767.283L821.11%20650.733L820.585%20766.758Z%22%2F%3E%0A%3Cpath%20class%3D%22mark%22%20d%3D%22M937.694%20649.684L821.11%20650.733L938.744%20533.135L937.694%20649.684Z%22%2F%3E%0A%3Cpath%20class%3D%22mark%22%20d%3D%22M1054.8%20532.611L938.744%20533.135L1055.33%20416.586L1054.8%20532.611Z%22%2F%3E%0A%3Cpath%20class%3D%22mark%22%20d%3D%22M1054.8%20336.259L1055.33%20416.583L974.454%20335.733L1054.8%20336.259Z%22%2F%3E%0A%3C%2Fg%3E%0A%3Cdefs%3E%0A%3CclipPath%20id%3D%22clip0_36_7%22%3E%0A%3Crect%20width%3D%221412%22%20height%3D%221412%22%20fill%3D%22white%22%2F%3E%0A%3C%2FclipPath%3E%0A%3C%2Fdefs%3E%0A%3C%2Fsvg%3E%0A"

const wordmarkSrc =
	"data:image/svg+xml,%3Csvg%20width%3D%222769%22%20height%3D%22391%22%20viewBox%3D%220%200%202769%20391%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%0A%3Cpath%20d%3D%22M2495.6%20239.383L2495.6%204.36719H2442.96L2442.96%20251.081C2442.96%20264.073%202446.69%20279.793%202455.73%20289.364C2464.76%20298.935%202471.68%20305.315%202488.69%20305.315H2549.84V263.31H2514.21C2507.02%20263.31%202501.82%20258.862%202499.33%20254.803C2496.83%20250.743%202495.6%20246.21%202495.6%20239.383Z%22%20fill%3D%22black%22%2F%3E%0A%3Crect%20x%3D%222543.46%22%20y%3D%2290.5039%22%20width%3D%2247.854%22%20height%3D%22146.752%22%20transform%3D%22rotate(90%202543.46%2090.5039)%22%20fill%3D%22black%22%2F%3E%0A%3Cpath%20d%3D%22M1734.79%200C1649.66%200%201580%2069.6496%201580%20154.777C1580%20239.904%201649.66%20309.554%201734.79%20309.554C1819.93%20309.554%201889.59%20240.334%201889.59%20154.777C1889.59%2069.2197%201820.36%200%201734.79%200ZM1734.79%20254.092C1681.91%20254.092%201639.34%20210.669%201639.34%20154.777C1639.34%2098.8852%201681.91%2055.4617%201734.79%2055.4617C1787.68%2055.4617%201830.25%2098.8852%201830.25%20154.777C1830.25%20210.669%201787.68%20254.092%201734.79%20254.092Z%22%20fill%3D%22black%22%2F%3E%0A%3Cpath%20d%3D%22M1984.56%208.62109L1862.87%20309.576H1922.64L1948.44%20243.796H2086.89L2112.69%20309.576H2173.32L2052.49%208.62109H1984.56ZM1967.79%20193.923L2017.67%2067.9522L2067.11%20193.923H1967.79Z%22%20fill%3D%22black%22%2F%3E%0A%3Cpath%20d%3D%22M2687.02%2086.0449C2662.08%2086.0449%202635.86%2097.2232%202623.82%20115.71V4.36719H2567.92V305.312H2623.82V189.659C2623.82%20156.124%202641.88%20134.198%202671.11%20134.198C2698.2%20134.198%202712.82%20154.835%202712.82%20183.64V305.312H2768.72V174.612C2768.72%20121.3%202736.04%2086.0449%202687.02%2086.0449Z%22%20fill%3D%22black%22%2F%3E%0A%3Cpath%20d%3D%22M2255.09%20309.773C2280.02%20309.773%202306.25%20298.595%202318.29%20280.108L2318.29%20305.474L2374.19%20305.474L2374.19%2090.5062L2318.29%2090.5062L2318.29%20206.159C2318.29%20239.694%202300.23%20261.621%202271%20261.621C2243.91%20261.621%202229.29%20240.984%202229.29%20212.178L2229.29%2090.5062L2173.39%2090.5062L2173.39%20221.207C2173.39%20274.519%202206.07%20309.773%202255.09%20309.773Z%22%20fill%3D%22black%22%2F%3E%0A%3Cpath%20d%3D%22M154.577%200C69.5595%200%200%2069.6066%200%20154.681C0%20239.756%2069.5595%20309.363%20154.577%20309.363C239.594%20309.363%20309.153%20240.186%20309.153%20154.681C309.153%2069.1769%20240.023%200%20154.577%200ZM154.577%20253.935C101.763%20253.935%2059.2544%20210.538%2059.2544%20154.681C59.2544%2098.8242%20101.763%2055.4275%20154.577%2055.4275C207.39%2055.4275%20249.899%2098.8242%20249.899%20154.681C249.899%20210.538%20207.39%20253.935%20154.577%20253.935ZM465.447%2085.9341C437.533%2085.9341%20410.487%2097.1055%20396.312%20116.011V90.2308H340.493V391H396.312V282.293C410.482%20299.91%20436.674%20309.363%20465.442%20309.363C525.555%20309.363%20572.787%20262.099%20572.787%20197.648C572.787%20133.198%20525.561%2085.9341%20465.447%2085.9341ZM455.996%20260.81C424.222%20260.81%20395.883%20235.889%20395.883%20197.648C395.883%20159.408%20424.222%20134.487%20455.996%20134.487C487.77%20134.487%20516.104%20159.408%20516.104%20197.648C516.104%20235.889%20487.77%20260.81%20455.996%20260.81ZM704.187%2085.9341C643.216%2085.9341%20595.125%20133.627%20595.125%20197.648C595.125%20261.669%20637.204%20309.363%20705.905%20309.363C762.154%20309.363%20798.222%20275.419%20809.385%20237.178H754.854C747.984%20253.076%20728.662%20264.247%20705.476%20264.247C676.707%20264.247%20654.809%20244.053%20649.656%20215.265H811.962V193.352C811.962%20134.916%20771.171%2085.9341%20704.187%2085.9341ZM650.086%20175.735C656.097%20148.666%20678.425%20131.049%20705.476%20131.049C734.244%20131.049%20756.142%20149.955%20758.719%20175.735H650.086ZM960.522%2085.9341C935.618%2085.9341%20909.426%2097.1055%20897.403%20115.581V90.2308H841.584V305.066H897.403V189.485C897.403%20155.97%20915.437%20134.057%20944.635%20134.057C971.686%20134.057%20986.285%20154.681%20986.285%20183.469V305.066H1042.1V174.446C1042.1%20121.167%201009.47%2085.9341%20960.522%2085.9341ZM1185.07%204.30681L1063.55%20305.076H1123.24L1149%20239.336H1287.26L1313.02%20305.076H1373.56L1252.91%204.30681H1185.07ZM1168.32%20189.495L1218.13%2063.6013L1267.51%20189.495H1168.32ZM1453%204.30681H1396.32V305.076H1453V4.30681Z%22%20fill%3D%22black%22%2F%3E%0A%3C%2Fsvg%3E%0A"

const systemFont =
	'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

const screenStyle: CSSProperties = {
	alignItems: "center",
	background: "#ffffff",
	color: "#111111",
	display: "flex",
	fontFamily: systemFont,
	inset: 0,
	justifyContent: "center",
	padding: "36px 24px",
	position: "fixed",
	zIndex: 2147483647,
}

const stackStyle: CSSProperties = {
	alignItems: "center",
	display: "flex",
	flexDirection: "column",
	textAlign: "center",
	width: "min(100%, 430px)",
}

const brandStyle: CSSProperties = {
	alignItems: "center",
	display: "inline-flex",
	gap: 7,
	marginBottom: 28,
}

const logoStyle: CSSProperties = {
	display: "block",
	height: 16,
	transform: "translateY(-1px)",
	width: 16,
}

const wordmarkStyle: CSSProperties = {
	display: "block",
	height: 15,
	width: "auto",
}

const titleStyle: CSSProperties = {
	fontSize: "clamp(25px, 3.1vw, 31px)",
	fontWeight: 540,
	letterSpacing: 0,
	lineHeight: 1.1,
	margin: 0,
	whiteSpace: "nowrap",
}

const leadStyle: CSSProperties = {
	color: "#111111",
	fontSize: 18,
	lineHeight: 1.45,
	margin: "18px auto 0",
	maxWidth: 330,
}

const listStyle: CSSProperties = {
	alignItems: "flex-start",
	display: "grid",
	gap: 14,
	listStyle: "none",
	margin: "34px 0 0",
	padding: 0,
	textAlign: "left",
	width: "fit-content",
}

const itemStyle: CSSProperties = {
	alignItems: "center",
	color: "#6f6f6f",
	display: "flex",
	fontSize: 18,
	gap: 14,
	lineHeight: 1.4,
}

const checkStyle: CSSProperties = {
	color: "#6f6f6f",
	flex: "0 0 auto",
	height: 17,
	width: 17,
}

const primaryButtonStyle: CSSProperties = {
	alignItems: "center",
	appearance: "none",
	background: "#111111",
	border: 0,
	borderRadius: 9999,
	boxSizing: "border-box",
	color: "#ffffff",
	cursor: "pointer",
	display: "inline-flex",
	fontFamily: systemFont,
	fontSize: 15,
	fontWeight: 500,
	justifyContent: "center",
	lineHeight: 1.2,
	minHeight: 50,
	padding: "13px 24px",
	width: "100%",
}

const actionsStyle: CSSProperties = {
	alignItems: "stretch",
	display: "flex",
	flexDirection: "column",
	gap: 12,
	marginTop: 38,
	width: "min(100%, 322px)",
}

const secondaryButtonStyle: CSSProperties = {
	...primaryButtonStyle,
	background: "#ffffff",
	border: "1px solid #d9d9d9",
	color: "#111111",
}

const statusStyle: CSSProperties = {
	color: "#8f8f8f",
	fontSize: 13,
	lineHeight: 1.3,
	margin: "2px 0 0",
	minHeight: "1.3em",
}

const footerStyle: CSSProperties = {
	alignItems: "center",
	bottom: 34,
	color: "#6f6f6f",
	display: "flex",
	flexDirection: "column",
	fontSize: 12,
	gap: 7,
	left: 24,
	lineHeight: 1.25,
	position: "fixed",
	right: 24,
	textAlign: "center",
}

const footerLinksStyle: CSSProperties = {
	alignItems: "center",
	display: "flex",
	gap: 8,
	justifyContent: "center",
}

const linkStyle: CSSProperties = {
	color: "inherit",
	textDecoration: "none",
}

const sourceLinkStyle: CSSProperties = {
	...linkStyle,
	textDecoration: "underline",
	textDecorationColor: "#d9d9d9",
	textUnderlineOffset: 3,
}

const sourceArrowStyle: CSSProperties = {
	display: "inline-block",
	fontSize: 12,
	marginLeft: 3,
	transform: "translateY(-1px)",
}

const CheckIcon = () => (
	<svg aria-hidden="true" style={checkStyle} viewBox="0 0 20 20">
		<path
			d="M8.1 13.7 4.4 10l-1.3 1.3 5 5L17 7.4 15.7 6z"
			fill="currentColor"
		/>
	</svg>
)

const getCenteredPopupFeatures = (): string => {
	const width = Math.min(popupWidth, window.screen.availWidth)
	const height = Math.min(popupHeight, window.screen.availHeight)
	const left = Math.round(window.screenX + (window.outerWidth - width) / 2)
	const top = Math.round(window.screenY + (window.outerHeight - height) / 2)

	return [
		"popup=yes",
		`width=${width}`,
		`height=${height}`,
		`left=${left}`,
		`top=${top}`,
	].join(",")
}

export const SignInWithChatGPTExtensionScreen = ({
	browserExtensionDetectionTimeoutMs,
	browserExtensionId,
	chromeWebStoreUrl = defaultChromeWebStoreUrl,
	githubUrl = defaultGithubUrl,
	legalUrl = defaultLegalUrl,
	onCancel,
	onContinue,
	pollIntervalMs = defaultPollIntervalMs,
}: SignInWithChatGPTExtensionScreenProps) => {
	const [status, setStatus] = useState("")
	const hasContinuedRef = useRef(false)
	const hasOpenedInstallWindowRef = useRef(false)
	const onContinueRef = useRef(onContinue)

	onContinueRef.current = onContinue

	useEffect(() => {
		let active = true
		let timeoutId: number | undefined

		const checkInstalled = async () => {
			if (timeoutId !== undefined) {
				window.clearTimeout(timeoutId)
				timeoutId = undefined
			}
			const installed = await isBrowserExtensionInstalled({
				extensionId: browserExtensionId,
				timeoutMs: browserExtensionDetectionTimeoutMs,
			})
			if (!active || hasContinuedRef.current) {
				return
			}
			if (installed) {
				hasContinuedRef.current = true
				setStatus("Extension installed. Continuing...")
				void onContinueRef.current()
				return
			}
			timeoutId = window.setTimeout(checkInstalled, pollIntervalMs)
		}

		const checkOnReturn = () => {
			if (document.visibilityState === "visible") {
				void checkInstalled()
			}
		}

		window.addEventListener("focus", checkOnReturn)
		document.addEventListener("visibilitychange", checkOnReturn)
		void checkInstalled()

		return () => {
			active = false
			window.removeEventListener("focus", checkOnReturn)
			document.removeEventListener("visibilitychange", checkOnReturn)
			if (timeoutId !== undefined) {
				window.clearTimeout(timeoutId)
			}
		}
	}, [browserExtensionDetectionTimeoutMs, browserExtensionId, pollIntervalMs])

	const handlePrimaryClick = () => {
		if (hasOpenedInstallWindowRef.current) {
			setStatus("Chrome Web Store is already open.")
			return
		}

		setStatus("Waiting for extension to be installed...")
		const features = getCenteredPopupFeatures()
		const opened = window.open(chromeWebStoreUrl, popupName, features)
		if (opened) {
			hasOpenedInstallWindowRef.current = true
			opened.focus()
			return
		}

		const tab = window.open(chromeWebStoreUrl, "_blank")
		if (tab) {
			hasOpenedInstallWindowRef.current = true
			tab.focus()
			return
		}

		setStatus(
			"Popup blocked. Please allow popups or open the Chrome Web Store.",
		)
	}

	const handleCancelClick = () => {
		onCancel?.()
	}

	return (
		<div
			aria-labelledby="openai-oauth-extension-title"
			aria-modal="true"
			role="dialog"
			style={screenStyle}
		>
			<section style={stackStyle}>
				<div style={brandStyle}>
					<img alt="" src={logoSrc} style={logoStyle} />
					<img alt="OpenAI OAuth" src={wordmarkSrc} style={wordmarkStyle} />
				</div>

				<div>
					<h1 id="openai-oauth-extension-title" style={titleStyle}>
						Sign in with ChatGPT
					</h1>
					<p style={leadStyle}>
						A Chrome extension is required
						<br />
						to securely sign in.
					</p>
				</div>

				<ul style={listStyle}>
					<li style={itemStyle}>
						<CheckIcon />
						<span>Only works after you sign in</span>
					</li>
					<li style={itemStyle}>
						<CheckIcon />
						<span>Never reads your browsing</span>
					</li>
					<li style={itemStyle}>
						<CheckIcon />
						<span>
							Free and{" "}
							<a
								href={githubUrl}
								rel="noreferrer"
								style={sourceLinkStyle}
								target="_blank"
							>
								open source
								<span aria-hidden="true" style={sourceArrowStyle}>
									↗
								</span>
							</a>
						</span>
					</li>
				</ul>

				<div style={actionsStyle}>
					<button
						onClick={handlePrimaryClick}
						style={primaryButtonStyle}
						type="button"
					>
						Continue to Chrome Web Store
					</button>
					<button
						onClick={handleCancelClick}
						style={secondaryButtonStyle}
						type="button"
					>
						Cancel
					</button>
					<p aria-live="polite" style={statusStyle}>
						{status}
					</p>
				</div>
			</section>
			<footer style={footerStyle}>
				<a href={githubUrl} rel="noreferrer" style={linkStyle} target="_blank">
					Learn more about OpenAI OAuth
				</a>
				<div style={footerLinksStyle}>
					<a
						href={githubUrl}
						rel="noreferrer"
						style={linkStyle}
						target="_blank"
					>
						GitHub
					</a>
					<span aria-hidden="true">⋅</span>
					<a href={legalUrl} rel="noreferrer" style={linkStyle} target="_blank">
						Legal
					</a>
				</div>
			</footer>
		</div>
	)
}
