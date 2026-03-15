# openai-oauth

Free OpenAI API access with your ChatGPT account.

Just run `npx openai-oauth`.

## How to Use

You can currently use `openai-oauth` in two different ways:

### `openai-oauth` CLI

This package lets you create a localhost proxy to `chatgpt.com/backend-api/codex/responses` pre-authenticated with your Oauth tokens.

Use directly:

```bash
npx openai-oauth

OpenAI-compatible endpoint ready at http://127.0.0.1:10531/v1
Use this as your OpenAI base URL. No API key is required.
```

### `openai-oauth-provider`

This is a Vercel AI SDK Provider.

```ts
import { generateText } from "ai"
import { createOpenAIOAuth } from "openai-oauth-provider"

const openai = createOpenAIOAuth()

const result = await generateText({
	model: openai("gpt-5.4"),
	prompt: "write an essay about dogs",
})

console.log(result.text)
```

## Configuration

The CLI and the provider share the same core OAuth transport settings.

| Config | CLI | Provider | Default | Description |
| --- | --- | --- | --- | --- |
| Host binding | `--host` | N/A | `127.0.0.1` | Host interface the local proxy binds to. |
| Port | `--port` | N/A | `10531` | Port the local proxy binds to. |
| Model allowlist | `--models` | N/A | `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`, `gpt-5.2`, `gpt-5.1`, `gpt-5.1-codex`, `gpt-5.1-codex-max` | Comma-separated list of model ids exposed by `/v1/models`. |
| Upstream base URL | `--base-url` | `baseURL` | `https://chatgpt.com/backend-api/codex` | Override the upstream Codex base URL. |
| OAuth client id | `--oauth-client-id` | `clientId` | `app_EMoamEEZ73f0CkXaXp7hrann` | Override the OAuth client id used for refresh. |
| OAuth token URL | `--oauth-token-url` | `tokenUrl` | `https://auth.openai.com/oauth/token` | Override the OAuth token URL used for refresh. |
| Auth file path | `--oauth-file` | `authFilePath` | `--oauth-file` path if provided, otherwise `$CHATGPT_LOCAL_HOME/auth.json`, `$CODEX_HOME/auth.json`, `~/.chatgpt-local/auth.json`, `~/.codex/auth.json` | Override where the local OAuth auth file is discovered. |
| Ensure fresh tokens | N/A | `ensureFresh` | `true` | Control whether access tokens are refreshed automatically. |
| Provider name | N/A | `name` | `openai` | Override the provider name exposed to Vercel AI SDK internals. |

## Features

What currently works:

- Working Endpoints:
  - `/v1/responses`
  - `/v1/chat/completions`
  - `/v1/models` (with configurable model allowlist)
- Streaming Responses
- Toolcalls
- Reasoning Traces

## Known Limitations

What is intentionally not there yet:

- Only LLMs supported by Codex are available. This lists updates over time and is dependent on your Codex plan.
- Login flow is intentionally not bundled. Simply run `npx @openai/codex login` to create the auth file.
- Stateful replay support on the CLI `/v1/responses` endpoint
  The proxy is stateless and expects callers to send the full conversation history.

## How it Works

OpenAI's Codex CLI uses a special endpoint at `chatgpt.com/backend-api/codex/responses` to let you use special OpenAI rate limits tied to your ChatGPT account.

By using the same Oauth tokens as Codex, we can effectively use OpenAI's API through Oauth instead of buying API credits.

## Monorepo

- `packages/openai-oauth-core`
  Private shared transport, auth refresh, SSE helpers, and replay state.
- `packages/openai-oauth-provider`
  Public Vercel AI SDK provider that talks directly to Codex using local auth files.
- `packages/openai-oauth`
  Public CLI and localhost proxy package intended for `npx openai-oauth`.
