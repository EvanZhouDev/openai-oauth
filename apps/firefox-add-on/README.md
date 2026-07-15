# Sign in with ChatGPT for Firefox

[Firefox Add-ons](https://addons.mozilla.org/firefox/addon/sign-in-with-chatgpt/) | [Privacy](https://github.com/EvanZhouDev/openai-oauth/blob/main/PRIVACY.md) | [GitHub](https://github.com/EvanZhouDev/openai-oauth)

Firefox add-on for hosted OpenAI OAuth sign-in.

OpenAI accepts a local callback at `http://localhost:1455/auth/callback`, but hosted apps cannot receive that callback directly. The add-on redirects only that exact callback, shows the destination app for confirmation, and returns the callback after the user continues.

Its only host permission is `http://localhost/*`, the narrowest localhost permission Firefox supports. The add-on's rules still match only port `1455`, and OpenAI OAuth does not operate a server that receives the callback.

## Development

```bash
bun run --cwd apps/firefox-add-on dev
```

This builds the add-on and starts Firefox with a temporary installation through `web-ext`.

## Validate

```bash
bun run --cwd apps/firefox-add-on lint:add-on
```

## Package

```bash
bun run --cwd apps/firefox-add-on pack
```

The package is written to `apps/firefox-add-on/dist-pack` for submission to [Firefox Add-ons](https://addons.mozilla.org/developers/).
