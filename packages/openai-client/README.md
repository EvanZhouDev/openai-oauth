# @openai-oauth/openai-client

[Docs](https://github.com/EvanZhouDev/openai-oauth#client-adapters) | [GitHub](https://github.com/EvanZhouDev/openai-oauth) | [npm](https://www.npmjs.com/package/@openai-oauth/openai-client)

Use OpenAI OAuth credentials with the OpenAI JavaScript SDK.

```bash
npm i @openai-oauth/openai-client @openai-oauth/local openai
```

Quickstart:

```ts
import { createOpenAIOptions } from "@openai-oauth/openai-client";
import { openaiCredentials } from "@openai-oauth/local";
import OpenAI from "openai";

const client = new OpenAI(createOpenAIOptions(openaiCredentials()));
```

The standard OpenAI image APIs work with GPT Image 2:

```ts
import fs from "node:fs";

const result = await client.images.generate({
	model: "gpt-image-2",
	prompt: "A tiny house in a forest",
});

const edited = await client.images.edit({
	model: "gpt-image-2",
	prompt: "Add a red hat",
	image: fs.createReadStream("input.png"),
});
```

## Package Notes

`@openai-oauth/openai-client` turns an OpenAI OAuth credential source into options for `new OpenAI()`.

It works with any credential source:

```ts
import { openaiCredentials } from "@openai-oauth/local";

const client = new OpenAI(createOpenAIOptions(openaiCredentials()));
```

For web apps, create the client inside your own server route with request-bound credentials:

```ts
import { createOpenAIOptions } from "@openai-oauth/openai-client";
import { openaiCredentials } from "@openai-oauth/react/server";
import OpenAI from "openai";

export async function POST(request: Request) {
	const client = new OpenAI(createOpenAIOptions(openaiCredentials(request)));
	const response = await client.responses.create({
		model: "gpt-5.4-mini",
		input: await request.text(),
	});

	return Response.json(response);
}
```

Use `@openai-oauth/react` to establish the browser credentials. See the [Sign in with ChatGPT setup](https://github.com/EvanZhouDev/openai-oauth#react-component).

The default `apiKey` is the placeholder string `openai-oauth`. Authentication is handled by the custom `fetch` implementation.

Useful options:

```ts
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

## More

[Learn more in the openai-oauth README.](https://github.com/EvanZhouDev/openai-oauth#client-adapters)
