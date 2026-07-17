# @openai-oauth/core

[Docs](https://github.com/EvanZhouDev/openai-oauth#sdk-overview) | [GitHub](https://github.com/EvanZhouDev/openai-oauth) | [npm](https://www.npmjs.com/package/@openai-oauth/core)

Lowest-level OpenAI OAuth and OpenAI-compatible transport primitives.

```bash
npm i @openai-oauth/core
```

Most apps should use `openai-oauth`, `@openai-oauth/local`, `@openai-oauth/react`, `@openai-oauth/ai-sdk`, or `@openai-oauth/openai-client` instead.

## Package Notes

`@openai-oauth/core` is for advanced integrations and adapter authors.

Create an OpenAI-compatible transport from an explicit auth source:

```ts
import { createOpenAIOAuthTransport } from "@openai-oauth/core";

const transport = createOpenAIOAuthTransport({
	auth: async () => session,
	responsesStateOptions: {
		maxResponses: 256,
		maxItems: 2_000,
	},
});

const baseURL = transport.baseURL;
const fetch = transport.fetch;
```

The transport supports Responses, model discovery, image generation, and multipart image editing. Its in-memory Responses cache maps saved response IDs to request inputs and response outputs, and saved item IDs to response items. The cache defaults to 256 responses and 2,000 items; `responsesStateOptions` can set either positive-integer bound. Client adapters build higher-level interfaces such as Chat Completions on top.

Create an OAuth request:

```ts
import { createOpenAIOAuthRequest } from "@openai-oauth/core";

const request = await createOpenAIOAuthRequest({
	redirectUri: "https://app.example.com/auth/callback",
});
```

Core exports include:

- `createOpenAIOAuthTransport`
- `createOpenAIOAuthRequest`
- `exchangeOpenAIOAuthCode`
- `refreshOpenAIOAuthTokens`
- `OpenAIOAuth`
- `OpenAIOAuthSession`
- `SessionStore`

## More

[Learn more in the openai-oauth README.](https://github.com/EvanZhouDev/openai-oauth#sdk-overview)
