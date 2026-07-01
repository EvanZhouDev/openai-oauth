<picture>
  <source media="(prefers-color-scheme: dark)" srcset="/assets/banner-dark.webp" type="image/webp">
  <source media="(prefers-color-scheme: light)" srcset="/assets/banner-light.webp" type="image/webp">
  <source media="(prefers-color-scheme: dark)" srcset="/assets/banner-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="/assets/banner-light.png">
  <img src="/assets/banner-light.png" alt="OpenAI OAuth: Free AI with your ChatGPT account">
</picture>

<p align="center">
    <a href="https://www.npmjs.com/package/openai-oauth">NPM</a> | <a href="#legal">Legal</a>
</p>

> [!NOTE]
> ### What's new in v2?
>
> - [**Sign in with ChatGPT**](#react-component): Let your users sign in with their ChatGPT accounts in React
> - [**Generalized Client Support**](#client-adapters): Use with OpenAI Client, AI SDK, or any other OpenAI-Compatible client
> - [**CLI Login**](#openai-oauth-cli): You can now login via `npx openai-oauth`
> - [**Cleaner Package Architecture**](#sdk-overview): Separate packages for CLI, credentials, clients, and more

# Quickstart

### Dev Proxy

Turn your ChatGPT account into an OpenAI-Compatible API. [Learn more](#dev-proxy)

```txt
$ npx openai-oauth

OpenAI-compatible endpoint ready at http://127.0.0.1:10531/v1
Use this as your OpenAI base URL. No API key is required.
Available Models: gpt-5.5, gpt-5.4, ...
```

### TypeScript SDK

Access your ChatGPT account directly from TypeScript on your machine

```bash
npm i @openai-oauth/local @openai-oauth/ai-sdk ai
```

If you are not signed in to Codex locally, first run `npx openai-oauth login`.

```ts
import { createOpenAIOAuth } from "@openai-oauth/ai-sdk";
import { openaiCredentials } from "@openai-oauth/local";
import { generateText } from "ai";

const openai = createOpenAIOAuth(openaiCredentials());

const result = await generateText({
	model: openai("gpt-5.4-mini"),
	prompt: "Hello!",
});
```

Works with any OpenAI-compatible client. [Learn more](#typescript-sdk)

### React Component

Let your users sign in with their ChatGPT accounts.

<picture>
  <source srcset="/assets/sign-in-with-chatgpt-button.webp" type="image/webp">
  <img src="/assets/sign-in-with-chatgpt-button.png" alt="Sign in with ChatGPT" width="320">
</picture>

```bash
npm i @openai-oauth/react @openai-oauth/ai-sdk ai @ai-sdk/react
```

Quickstart for Next.js:

```tsx
// app/page.tsx
"use client";

import { openaiAuthHeaders, SignInWithChatGPT } from "@openai-oauth/react";
import { useCompletion } from "@ai-sdk/react";

export default function Page() {
	const { complete, completion, isLoading } = useCompletion({
		api: "/api/chat",
		streamProtocol: "text",
	});

	return (
		<>
			<SignInWithChatGPT />
			<button
				disabled={isLoading}
				onClick={async () => {
					await complete("Hello!", {
						headers: await openaiAuthHeaders(),
					});
				}}
			>
				Ask
			</button>
			<p>{completion}</p>
		</>
	);
}
```

```ts
// app/api/chat/route.ts
import { createOpenAIOAuth } from "@openai-oauth/ai-sdk";
import { openaiCredentials } from "@openai-oauth/react/server";
import { streamText } from "ai";

export async function POST(request: Request) {
	const { prompt } = await request.json();
	const openai = createOpenAIOAuth(openaiCredentials(request));

	const result = streamText({
		model: openai("gpt-5.4-mini"),
		prompt,
	});

	return result.toTextStreamResponse();
}
```

Works with any web framework and OpenAI-compatible client. [Learn more](#react-component)

# Docs

For more information on each of the packages, refer to package-specific `README.md`.

## What is Supported

- Working Endpoints:
  - `/v1/responses`
  - `/v1/chat/completions`
  - `/v1/models` (account-aware by default, or overridden with `--models`)
- Streaming Responses
- Toolcalls
- Reasoning Traces

See [Known Limitations](#known-limitations) for more information.

## `openai-oauth` CLI

```bash
npx openai-oauth
```

This starts an OpenAI-compatible endpoint (by default at `localhost:10531`) that is connected to your ChatGPT account.

If you are not signed in, it will ask you to sign in locally. Your credentials will be stored in `~/.codex` (the same place `codex` CLI uses).

You can always directly sign in (without starting the server):

```bash
npx openai-oauth login
```

The CLI also supports a few configuration options that generally do not need to be edited.

<details>
<summary><code>openai-oauth</code> CLI Flags</summary>
<br>
<table>
  <thead>
    <tr>
      <th>Config</th>
      <th>CLI flag</th>
      <th>Default</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Host binding</td>
      <td><code>--host</code></td>
      <td><code>127.0.0.1</code></td>
      <td>Host interface the local proxy binds to.</td>
    </tr>
    <tr>
      <td>Port</td>
      <td><code>--port</code></td>
      <td><code>10531</code></td>
      <td>Port the local proxy binds to.</td>
    </tr>
    <tr>
      <td>Model allowlist</td>
      <td><code>--models</code></td>
      <td>Account-specific Codex models discovered from ChatGPT</td>
      <td>Comma-separated list of model ids exposed by <code>/v1/models</code>. When omitted, the CLI discovers the models your account has access to.</td>
    </tr>
    <tr>
      <td>Codex API version</td>
      <td><code>--codex-version</code></td>
      <td>Local <code>codex --version</code>, then latest <code>@openai/codex</code> from npm, then <code>0.111.0</code></td>
      <td>Override the Codex API client version used for model discovery.</td>
    </tr>
    <tr>
      <td>Upstream base URL</td>
      <td><code>--base-url</code></td>
      <td><code>https://chatgpt.com/backend-api/codex</code></td>
      <td>Override the upstream Codex base URL.</td>
    </tr>
    <tr>
      <td>OAuth client ID</td>
      <td><code>--oauth-client-id</code></td>
      <td><code>app_EMoamEEZ73f0CkXaXp7hrann</code></td>
      <td>Override the OAuth client id used for login and refresh.</td>
    </tr>
    <tr>
      <td>OAuth token URL</td>
      <td><code>--oauth-token-url</code></td>
      <td><code>https://auth.openai.com/oauth/token</code></td>
      <td>Override the OAuth token URL used for login and refresh.</td>
    </tr>
    <tr>
      <td>Auth file path</td>
      <td><code>--oauth-file</code></td>
      <td><code>--oauth-file</code> path if provided, otherwise <code>$CHATGPT_LOCAL_HOME/auth.json</code>, <code>$CODEX_HOME/auth.json</code>, <code>~/.chatgpt-local/auth.json</code>, <code>~/.codex/auth.json</code></td>
      <td>Override where the local OAuth auth file is discovered.</td>
    </tr>
    <tr>
      <td>Open browser</td>
      <td><code>--open</code> / <code>--no-open</code></td>
      <td><code>--open</code></td>
      <td>Open the login URL in a browser during <code>npx openai-oauth login</code>. Use <code>--no-open</code> to print the URL instead.</td>
    </tr>
    <tr>
      <td>Login timeout</td>
      <td><code>--login-timeout-ms</code></td>
      <td><code>300000</code></td>
      <td>How long the login command waits for the OAuth callback, in milliseconds.</td>
    </tr>
  </tbody>
</table>
</details>

## SDK Overview

The `openai-oauth` SDK allows you to integrate ChatGPT login into your local apps and also enable **Sign in with ChatGPT** for your users.

<picture>
  <source srcset="/assets/package-structure.webp" type="image/webp">
  <img src="/assets/package-structure.png" alt="OpenAI OAuth package structure">
</picture>

The SDK is primarily built around two concepts:

- **Credential Sources**: A way to get a ChatGPT OAuth session
  - Such as local authentication, or when a user auths with **Sign in with ChatGPT**
- **Client Adapters**: Allows you to actually use the Credential Source
  - Such as with Vercel's AI SDK or with the OpenAI client

In general, the SDK will follow this pattern:

```ts
import { openaiCredentials } from "@openai-oauth/local";
import { createOpenAIOAuth } from "@openai-oauth/ai-sdk";
import { generateText } from "ai";

// Get credentials from local
const credentials = openaiCredentials();

// Use those credentials to create an AI SDK object
const openai = createOpenAIOAuth(credentials);

// Use AI SDK to run the request
const result = await generateText({
	model: openai("gpt-5.4-mini"),
	prompt: "Hello!",
});
```

## Credential Sources

These allow you to get the OAuth credentials from OpenAI.

### `@openai-oauth/local`

```bash
npm i @openai-oauth/local
```

Use local Codex credentials which live on your machine (normally at `~/.codex`).

```ts
import { openaiCredentials } from "@openai-oauth/local";

const credentials = openaiCredentials();
```

This should work out-of-the-box if you're already logged in with Codex, but to log in again, you can run `npx openai-oauth login`.

You can also point to a specific auth file:

```ts
const credentials = openaiCredentials({
	authFilePath: "/path/to/auth.json",
});
```

### `@openai-oauth/react`

```bash
npm i @openai-oauth/react
```

Use request-bound credentials from the user's browser, with **Sign in with ChatGPT**.

```ts
import { openaiCredentials } from "@openai-oauth/web/server";

const credentials = openaiCredentials(request);
```

In order to actually establish the credentials in the user's browser, you can use `openai-oauth`'s built-in **Sign in with ChatGPT** SDK, [documented below](#sign-in-with-chatgpt-setup).

For framework neutral usage, see documentation for `@openai-oauth/web` in `packages/web`.

### How are web credentials stored?

Your OpenAI credentials are by default stored on your device in IndexedDB and encrypted at rest with WebCrypto.
Your app server receives request-bound credentials only when the browser sends them with `openaiAuthHeaders()`.

`openai-oauth` lets you bring your own credential storage solution if this is not good enough. See documentation for `@openai-oauth/web` in `packages/web` for more information.

## Client Adapters

These adapters let you use your `openai-oauth` credentials in any client.

### `@openai-oauth/ai-sdk`

```bash
npm i openai @openai-oauth/ai-sdk
```

Connect `openai-oauth` to Vercel AI SDK with this provider.

```ts
import { createOpenAIOAuth } from "@openai-oauth/ai-sdk";
import { openaiCredentials } from "@openai-oauth/local";
import { generateText } from "ai";

const openai = createOpenAIOAuth(openaiCredentials());

const result = await generateText({
	model: openai("gpt-5.5"),
	prompt: "Reply with exactly: hello",
});
```

[Learn more](https://ai-sdk.dev/) about how to use Vercel AI SDK.
See supported features [above](#what-is-supported).

### `@openai-oauth/openai-client`

```bash
npm i openai @openai-oauth/openai-client
```

OpenAI JavaScript SDK options adapter.

```ts
import { createOpenAIOptions } from "@openai-oauth/openai-client";
import { openaiCredentials } from "@openai-oauth/local";
import OpenAI from "openai";

const client = new OpenAI(createOpenAIOptions(openaiCredentials()));
```

### Custom Adapters

`openai-oauth` also works with any OpenAI-compatible client as long as it takes a custom `baseURL` and `fetch`.

```ts
import { createOpenAIOAuthTransport } from "@openai-oauth/core";
import { openaiCredentials } from "@openai-oauth/local";

const credentials = openaiCredentials();

const transport = createOpenAIOAuthTransport({
	auth: () => credentials.getSession(),
});

const baseURL = transport.baseURL;
const fetch = transport.fetch;
```

For example, here's how you would implement the OpenAI JavaScript SDK manually:

```ts
const client = new OpenAI({
	apiKey: "openai-oauth",
	baseURL: transport.baseURL,
	fetch: transport.fetch,
});
```

## Sign in with ChatGPT Setup

Use `SignInWithChatGPT` when users should sign in with their own ChatGPT account.

```bash
npm i @openai-oauth/react
```

It is currently only available for React.

```tsx
"use client";

import { SignInWithChatGPT } from "@openai-oauth/react";

export default function Page() {
	return <SignInWithChatGPT />;
}
```

The button handles the full browser sign-in flow. After sign-in, it becomes a disconnect button.

The prebuilt button includes a small "Powered by OpenAI OAuth" link by default to support this project. Pass `hideAttribution` to remove the attribution link.

Due to CORS, you will need a server relay to call the actual AI API. One way to do this is to send the browser session to your own app route:

```ts
import { openaiAuthHeaders } from "@openai-oauth/react";

await fetch("/api/chat", {
	method: "POST",
	headers: await openaiAuthHeaders(),
	body: "Hello!",
});
```

Then read request-bound credentials on the server:

```ts
import { createOpenAIOAuth } from "@openai-oauth/ai-sdk";
import { openaiCredentials } from "@openai-oauth/react/server";
import { generateText } from "ai";

export async function POST(request: Request) {
	const openai = createOpenAIOAuth(openaiCredentials(request));

	const result = await generateText({
		model: openai("gpt-5.4-mini"),
		prompt: await request.text(),
	});

	return new Response(result.text);
}
```

Useful props:

```tsx
<SignInWithChatGPT
	onSuccess={(session) => console.log(session.accountId)}
	onError={(error) => console.error(error.message)}
	onStateChange={(state) => console.log(state.status)}
	hideAttribution
/>
```

Additionally, you can create a custom sign in system with the hook.

```tsx
import { useSignInWithChatGPT } from "@openai-oauth/react";

function CustomLogin() {
	const login = useSignInWithChatGPT();

	if (login.status === "signed-in") {
		return <button onClick={() => void login.logout()}>Disconnect</button>;
	}

	return (
		<button onClick={() => void login.login()}>Sign in with ChatGPT</button>
	);
}
```

## Known Limitations

What is intentionally not there yet:

- Only LLMs supported by Codex are available. This lists updates over time and is dependent on your Codex plan.
- There is no stateful replay support on the CLI `/v1/responses` endpoint. The proxy is stateless and expects callers to send the full conversation history.

## How it Works

OpenAI's Codex CLI uses an endpoint at `chatgpt.com/backend-api/codex/responses` to let you use special OpenAI rate limits tied to your ChatGPT account.

By using the same Oauth tokens as Codex, we can effectively use OpenAI's API through Oauth instead of buying API credits.

# Legal

This is an unofficial, community-maintained project and is not affiliated with, endorsed by, or sponsored by OpenAI, Inc.

It uses your local Codex/ChatGPT authentication cache (auth.json, e.g. ~/.codex/auth.json) and should be treated like password-equivalent credentials.

Use only for personal, local experimentation on trusted machines; do not run as a hosted service, do not share access, and do not pool or redistribute tokens.

You are solely responsible for complying with OpenAI’s Terms, policies, and any applicable agreements; misuse may result in rate limits, suspension, or termination.

Provided “as is” with no warranties; you assume all risk for data exposure, costs, and account actions.
