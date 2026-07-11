# Sign in with ChatGPT

[Chrome Web Store](https://chromewebstore.google.com/detail/sign-in-with-chatgpt/odbgboachaefbbbdiffcefhpkekhfcna) | [Privacy](https://github.com/EvanZhouDev/openai-oauth/blob/main/PRIVACY.md) | [GitHub](https://github.com/EvanZhouDev/openai-oauth)

This extension is the secure browser handoff for OpenAI OAuth's **Sign in with ChatGPT**.

OpenAI accepts a local callback at `http://localhost:1455/auth/callback`, but hosted apps cannot receive that callback directly. The extension uses one static rule for that exact callback, shows the destination app for confirmation, and returns the callback to the app after the user continues.

Its only host permission is `http://localhost:1455/*`, and OpenAI OAuth does not operate a server that receives the callback.

## Local Development

An unpacked extension must use the same ID as the Chrome Web Store listing so the SDK can detect it. Build with the listing's public key:

~~~bash
OPENAI_OAUTH_BROWSER_EXTENSION_KEY="..." bun run build:dev
~~~

Then load `apps/chrome-extension/dist-dev` as an unpacked extension in Chrome.

Create the Chrome Web Store package with:

~~~bash
bun run pack
~~~

## Legal

This is an unofficial, community-maintained project and is not affiliated with, endorsed by, or sponsored by OpenAI, Inc.

It uses your local Codex/ChatGPT authentication cache (auth.json, e.g. ~/.codex/auth.json) and should be treated like password-equivalent credentials.

Use only for personal, local experimentation on trusted machines; do not run as a hosted service, do not share access, and do not pool or redistribute tokens.

You are solely responsible for complying with OpenAI’s Terms, policies, and any applicable agreements; misuse may result in rate limits, suspension, or termination.

Provided “as is” with no warranties; you assume all risk for data exposure, costs, and account actions.
