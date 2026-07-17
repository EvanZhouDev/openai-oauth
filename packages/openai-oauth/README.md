# openai-oauth

[Docs](https://github.com/EvanZhouDev/openai-oauth#dev-proxy) | [GitHub](https://github.com/EvanZhouDev/openai-oauth) | [npm](https://www.npmjs.com/package/openai-oauth)

Turn your ChatGPT account into an OpenAI-compatible local API.

```bash
> npx openai-oauth

OpenAI-compatible endpoint ready at http://127.0.0.1:10531/v1
Use this as your OpenAI base URL. No API key is required.
Available Models: gpt-5.6-sol, gpt-5.6-terra, gpt-image-2, ...

[d] Run in background  [q] Quit
```

Press `d` to keep it running in the background or `q` to quit. You can also manage it directly:

```bash
npx openai-oauth --detach
npx openai-oauth status
npx openai-oauth logs --follow
npx openai-oauth stop
```

## Package Notes

`openai-oauth` exposes an OpenAI-compatible local endpoint backed by your ChatGPT account.

Supported endpoints:

- `/v1/responses`
- `/v1/chat/completions`
- `/v1/images/generations`
- `/v1/images/edits`
- `/v1/models`

Image generation uses JSON requests. Image editing uses the standard OpenAI multipart request with one or more `image` fields. Both return base64 image data and usage metadata.

```bash
curl http://127.0.0.1:10531/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","prompt":"A tiny house in a forest","quality":"low"}'
```

Common flags:

| Config | Flag | Default |
| --- | --- | --- |
| Host binding | `--host` | `127.0.0.1` |
| Port | `--port` | `10531` |
| Model allowlist | `--models` | Account-specific Codex models discovered from ChatGPT |
| Auth file path | `--oauth-file` | `$CODEX_HOME/auth.json` or `~/.codex/auth.json` |
| Responses continuation | `--responses-state` | `stateless` |
| Open browser | `--open` / `--no-open` | `--open` |
| Login timeout | `--login-timeout-ms` | `300000` |

Binding `--host` beyond loopback exposes the proxy to your network. Anyone who can reach that port can make requests with your ChatGPT account.

Login listens on loopback and uses `http://localhost:1455/auth/callback`, the local callback URL accepted by OpenAI OAuth.

The CLI resolves the latest published Codex client version automatically. Advanced flags also exist for overriding it, the upstream Codex base URL, OAuth client id, and OAuth token URL.

### Responses continuation state

The server is stateless by default, so clients must send their full conversation history with every Responses request. Clients that continue with `previous_response_id` or `item_reference` can opt into the bounded in-memory state already provided by `@openai-oauth/core`:

```bash
npx openai-oauth --responses-state memory
```

Memory mode retains conversation and tool content only in the server process. It does not persist across restarts, so references created by a previous process cannot be continued; start a new client conversation after restarting the server. The state is bounded and discarded when the process exits. The server still sends expanded full history upstream, where repeated prompt prefixes can remain eligible for upstream prompt caching.

The same mode is available programmatically through `responsesState: "memory"` on `createOpenAIOAuthFetchHandler()` and `startOpenAIOAuthServer()`.

## More

[Learn more in the openai-oauth README.](https://github.com/EvanZhouDev/openai-oauth#readme)
