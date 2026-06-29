# @openai-oauth/openai-client

OpenAI JavaScript SDK adapter for openai-oauth auth handles.

```ts
import OpenAI from "openai";
import { createOpenAIOptions } from "@openai-oauth/openai-client";
import { openaiCredentials } from "@openai-oauth/react";

const client = new OpenAI(createOpenAIOptions(openaiCredentials()));
```

## API

`createOpenAIOptions(input, options?)`

Input:

```ts
type OpenAIClientInput = OpenAIOAuthTransport | OpenAIOAuth;

type CreateOpenAIClientOptions = {
	apiKey?: string;
	baseURL?: string;
	defaultHeaders?: HeadersInit;
	dangerouslyAllowBrowser?: boolean;
};
```

Output:

```ts
type OpenAIClientOptions = {
	apiKey: string;
	baseURL: string;
	fetch: typeof fetch;
	defaultHeaders?: HeadersInit;
	dangerouslyAllowBrowser?: boolean;
};
```

The default `apiKey` is the placeholder string `openai-oauth`; authentication is handled by the transport fetch.
