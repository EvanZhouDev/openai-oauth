# Sign in with ChatGPT

This extension is the secure browser handoff for OpenAI OAuth's **Sign in with ChatGPT**.

It watches for OpenAI's `http://localhost:1455/auth/callback` redirect, asks the user to confirm the destination app, and relays the callback back to the page that started sign-in.

## Local Development

~~~bash
bun run build
~~~

Then load `apps/browser-extension/dist` as an unpacked extension in Chromium.

## Legal

This is an unofficial, community-maintained project and is not affiliated with, endorsed by, or sponsored by OpenAI, Inc.

It uses your local Codex/ChatGPT authentication cache (auth.json, e.g. ~/.codex/auth.json) and should be treated like password-equivalent credentials.

Use only for personal, local experimentation on trusted machines; do not run as a hosted service, do not share access, and do not pool or redistribute tokens.

You are solely responsible for complying with OpenAI’s Terms, policies, and any applicable agreements; misuse may result in rate limits, suspension, or termination.

Provided “as is” with no warranties; you assume all risk for data exposure, costs, and account actions.