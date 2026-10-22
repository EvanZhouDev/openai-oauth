import type { ReactNode } from "react"

type IconProps = {
	className?: string
	title?: string
}

const Svg = ({
	children,
	className = "icon",
	title,
	filled = false,
}: IconProps & { children: ReactNode; filled?: boolean }) => (
	<svg
		aria-hidden={title ? undefined : "true"}
		aria-label={title}
		className={className}
		fill={filled ? "currentColor" : "none"}
		focusable="false"
		role={title ? "img" : undefined}
		stroke={filled ? "none" : "currentColor"}
		strokeLinecap="round"
		strokeLinejoin="round"
		viewBox="0 0 24 24"
	>
		{children}
	</svg>
)

export const MenuIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M4 6h16M4 12h16M4 18h16" />
	</Svg>
)

export const SidebarIcon = (props: IconProps) => (
	<Svg {...props}>
		<rect height="16" rx="3" width="18" x="3" y="4" />
		<path d="M9 4v16" />
	</Svg>
)

export const NewChatIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M12 20h9" />
		<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
	</Svg>
)

export const SearchIcon = (props: IconProps) => (
	<Svg {...props}>
		<circle cx="11" cy="11" r="7" />
		<path d="m20 20-3.2-3.2" />
	</Svg>
)

export const SendIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M12 19V5" />
		<path d="m5 12 7-7 7 7" />
	</Svg>
)

export const StopIcon = (props: IconProps) => (
	<Svg {...props} filled>
		<rect height="10" rx="2" width="10" x="7" y="7" />
	</Svg>
)

export const PlusIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M12 5v14M5 12h14" />
	</Svg>
)

export const PaperclipIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.2-8.2a3.3 3.3 0 0 1 4.7 4.7l-8.3 8.2a1.6 1.6 0 0 1-2.3-2.3l7.6-7.5" />
	</Svg>
)

export const ImageIcon = (props: IconProps) => (
	<Svg {...props}>
		<rect height="16" rx="3" width="18" x="3" y="4" />
		<circle cx="8.5" cy="9.5" r="1.6" />
		<path d="m3.5 17 4.6-4.6a2 2 0 0 1 2.8 0L16 17.5" />
		<path d="m14 14.5 1.6-1.6a2 2 0 0 1 2.8 0l2.1 2.1" />
	</Svg>
)

export const CopyIcon = (props: IconProps) => (
	<Svg {...props}>
		<rect height="13" rx="2.5" width="13" x="8" y="8" />
		<path d="M5 16a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2" />
	</Svg>
)

export const CheckIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="m20 6-11 11-5-5" />
	</Svg>
)

export const RefreshIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M21 12a9 9 0 1 1-2.6-6.4" />
		<path d="M21 4v5h-5" />
	</Svg>
)

export const TrashIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M4 7h16" />
		<path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
		<path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
		<path d="M10 11v6M14 11v6" />
	</Svg>
)

export const PencilIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
	</Svg>
)

export const TerminalIcon = (props: IconProps) => (
	<Svg {...props}>
		<rect height="16" rx="3" width="18" x="3" y="4" />
		<path d="m7.5 9.5 3 2.5-3 2.5" />
		<path d="M13 15h4" />
	</Svg>
)

export const FileIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M14 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7Z" />
		<path d="M14 3v4h4" />
	</Svg>
)

export const FilePlusIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M14 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7Z" />
		<path d="M14 3v4h4" />
		<path d="M12 11v6M9 14h6" />
	</Svg>
)

export const FileEditIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M18 10V7l-4-4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3" />
		<path d="M14 3v4h4" />
		<path d="M14.5 20.5 20 15l2 2-5.5 5.5H14v-2Z" />
	</Svg>
)

export const FolderIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M3 7a2 2 0 0 1 2-2h3.6l2 2.4H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
	</Svg>
)

export const GlobeIcon = (props: IconProps) => (
	<Svg {...props}>
		<circle cx="12" cy="12" r="9" />
		<path d="M3.6 9h16.8M3.6 15h16.8" />
		<path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" />
	</Svg>
)

export const ListIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M9 6h11M9 12h11M9 18h11" />
		<path d="m3.5 6 1 1 2-2" />
		<path d="m3.5 12 1 1 2-2" />
		<path d="m3.5 18 1 1 2-2" />
	</Svg>
)

export const SparkleIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9Z" />
		<path d="M18.5 4v3M20 5.5h-3" />
	</Svg>
)

export const SettingsIcon = (props: IconProps) => (
	<Svg {...props}>
		<circle cx="12" cy="12" r="3.2" />
		<path d="M19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V20a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 18.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 8a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V8a1.6 1.6 0 0 0 1.5 1H22a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
	</Svg>
)

export const UserIcon = (props: IconProps) => (
	<Svg {...props}>
		<circle cx="12" cy="8.5" r="3.7" />
		<path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
	</Svg>
)

export const ChevronDownIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="m6 9 6 6 6-6" />
	</Svg>
)

export const ChevronRightIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="m9 6 6 6-6 6" />
	</Svg>
)

export const CloseIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M6 6l12 12M18 6 6 18" />
	</Svg>
)

export const DownloadIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M12 4v11" />
		<path d="m7.5 11.5 4.5 4.5 4.5-4.5" />
		<path d="M5 20h14" />
	</Svg>
)

export const SpinnerIcon = ({ className = "icon spin" }: IconProps) => (
	<svg
		aria-hidden="true"
		className={className}
		fill="none"
		focusable="false"
		stroke="currentColor"
		strokeLinecap="round"
		viewBox="0 0 24 24"
	>
		<circle cx="12" cy="12" opacity="0.25" r="9" strokeWidth="2" />
		<path d="M21 12a9 9 0 0 0-9-9" strokeWidth="2" />
	</svg>
)

export const CircleIcon = (props: IconProps) => (
	<Svg {...props}>
		<circle cx="12" cy="12" r="8" />
	</Svg>
)

export const CircleCheckIcon = (props: IconProps) => (
	<Svg {...props}>
		<circle cx="12" cy="12" r="8" />
		<path d="m8.5 12 2.5 2.5 4.5-5" />
	</Svg>
)

export const CircleDotIcon = (props: IconProps) => (
	<Svg {...props}>
		<circle cx="12" cy="12" r="8" />
		<circle cx="12" cy="12" fill="currentColor" r="3" stroke="none" />
	</Svg>
)

export const WarningIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M10.3 4.3 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
		<path d="M12 9.5v4M12 17h.01" />
	</Svg>
)

export const LockIcon = (props: IconProps) => (
	<Svg {...props}>
		<rect height="10" rx="2" width="14" x="5" y="11" />
		<path d="M8 11V7a4 4 0 0 1 8 0v4" />
	</Svg>
)

export const SunIcon = (props: IconProps) => (
	<Svg {...props}>
		<circle cx="12" cy="12" r="4" />
		<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
	</Svg>
)

export const MoonIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
	</Svg>
)

export const MoreIcon = (props: IconProps) => (
	<Svg {...props} filled>
		<circle cx="5" cy="12" r="1.7" />
		<circle cx="12" cy="12" r="1.7" />
		<circle cx="19" cy="12" r="1.7" />
	</Svg>
)

export const CodeIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="m8.5 8.5-4 3.5 4 3.5" />
		<path d="m15.5 8.5 4 3.5-4 3.5" />
		<path d="m13.5 5-3 14" />
	</Svg>
)

export const BrainIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M9.5 4.5A2.8 2.8 0 0 0 6.7 7 2.6 2.6 0 0 0 5 9.4c0 .8.3 1.5.9 2A2.8 2.8 0 0 0 5 13.6c0 1 .6 1.9 1.4 2.4 0 1.6 1.3 2.9 2.9 2.9 .9 0 1.7-.4 2.2-1V5.6a2.6 2.6 0 0 0-2-1.1Z" />
		<path d="M14.5 4.5A2.8 2.8 0 0 1 17.3 7a2.6 2.6 0 0 1 1.7 2.4c0 .8-.3 1.5-.9 2a2.8 2.8 0 0 1 .9 2.2c0 1-.6 1.9-1.4 2.4 0 1.6-1.3 2.9-2.9 2.9-.9 0-1.7-.4-2.2-1V5.6a2.6 2.6 0 0 1 2-1.1Z" />
	</Svg>
)

/** The project's own mark, used as the app logo. */
export const BrandIcon = ({ className = "icon" }: IconProps) => (
	<svg
		aria-hidden="true"
		className={className}
		fill="currentColor"
		focusable="false"
		viewBox="0 0 24 24"
	>
		<path d="M12 2.2a5.2 5.2 0 0 1 4.5 2.6 5.2 5.2 0 0 1 4 7.2 5.2 5.2 0 0 1-4.5 7.8A5.2 5.2 0 0 1 12 21.8a5.2 5.2 0 0 1-4-1.9 5.2 5.2 0 0 1-4.5-7.9 5.2 5.2 0 0 1 4-7.2A5.2 5.2 0 0 1 12 2.2Zm0 2a3.2 3.2 0 0 0-2.9 1.9l-.2.5-.5.1a3.2 3.2 0 0 0-2 4.6l.3.5-.3.5a3.2 3.2 0 0 0 2.6 4.8h.6l.3.5a3.2 3.2 0 0 0 5.5-.2l.3-.5h.6a3.2 3.2 0 0 0 2.6-4.8l-.3-.5.3-.5a3.2 3.2 0 0 0-2-4.6l-.5-.1-.2-.5A3.2 3.2 0 0 0 12 4.2Zm0 3.1 4 2.3v4.6l-4 2.3-4-2.3V9.6l4-2.3Z" />
	</svg>
)
