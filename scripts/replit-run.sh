#!/usr/bin/env bash
# Start script for Replit's Run button.
#
# Installs and builds only when something is actually missing, so pressing Run
# a second time starts the app in seconds instead of reinstalling everything.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
	echo "→ Installing dependencies (first run only)…"
	npm install
fi

if [ ! -d packages/core/dist ] || [ ! -d packages/react/dist ]; then
	echo "→ Building the workspace packages the app imports…"
	npm run build
fi

echo
echo "→ Starting the agent on port ${PORT:-3001}"
echo "  Open the webview in a new browser tab: sign-in popups are blocked inside"
echo "  Replit's embedded preview."
echo
exec npm run dev --prefix apps/agent
