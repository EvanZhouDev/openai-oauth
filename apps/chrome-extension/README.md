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

OpenAI OAuth is an unofficial, community-maintained project and is not affiliated with, endorsed by, or sponsored by OpenAI.

OpenAI OAuth uses ChatGPT credentials, which should be treated like passwords.

Each person must use their own ChatGPT account and keep credentials private. Do not pool, share, or redistribute access tokens. Apps offering Sign in with ChatGPT must protect each user's credentials and use them only for requests that user authorizes.

You are responsible for complying with OpenAI's [Terms of Use](https://openai.com/policies/terms-of-use/), [Usage Policies](https://openai.com/policies/usage-policies/), and any agreement that applies to your account. Do not bypass rate limits, restrictions, or safeguards.

Provided as-is with no warranties. OpenAI may change or disable the underlying services at any time, and you assume the risks of using this project.
