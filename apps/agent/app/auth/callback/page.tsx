import { AgentApp } from "../../components/AgentApp"

// The OAuth redirect lands here; the hook finishes the exchange and the app
// renders as normal once the session is stored.
export default function CallbackPage() {
	return <AgentApp />
}
