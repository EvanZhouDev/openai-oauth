# openai-oauth

OpenAI-compatible local endpoint backed by your ChatGPT account.

## Usage

```bash
npx openai-oauth login
npx openai-oauth
```

When startup succeeds, the CLI prints:

```text
OpenAI-compatible endpoint ready at http://127.0.0.1:10531/v1
Use this as your OpenAI base URL. No API key is required.
Available Models: gpt-5.4, gpt-5.3-codex, ...
```

If no auth file is available, log in first:

```bash
npx openai-oauth login
```

## Configuration

| Config            | CLI                 | Default                                                                                                                                                 | Description                                                                                                                        |
| ----------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Host binding      | `--host`            | `127.0.0.1`                                                                                                                                             | Host interface the local proxy binds to.                                                                                           |
| Port              | `--port`            | `10531`                                                                                                                                                 | Port the local proxy binds to.                                                                                                     |
| Model allowlist   | `--models`          | Account-specific Codex models discovered from ChatGPT                                                                                                   | Comma-separated list of model ids exposed by `/v1/models`. When omitted, the CLI mirrors the models your account can actually use. |
| Codex API version | `--codex-version`   | Local `codex --version`, then `@openai/codex` latest from npm, then `0.111.0`                                                                          | Override the Codex API client version used for model discovery.                                                                    |
| Upstream base URL | `--base-url`        | `https://chatgpt.com/backend-api/codex`                                                                                                                 | Override the upstream Codex base URL.                                                                                              |
| OAuth client id   | `--oauth-client-id` | `app_EMoamEEZ73f0CkXaXp7hrann`                                                                                                                          | Override the OAuth client id used for refresh.                                                                                     |
| OAuth token URL   | `--oauth-token-url` | `https://auth.openai.com/oauth/token`                                                                                                                   | Override the OAuth token URL used for refresh.                                                                                     |
| Auth file path    | `--oauth-file`      | `--oauth-file` path if provided, otherwise `$CHATGPT_LOCAL_HOME/auth.json`, `$CODEX_HOME/auth.json`, `~/.chatgpt-local/auth.json`, `~/.codex/auth.json` | Override where the local OAuth auth file is discovered.                                                                            |