# @openai-oauth/ai-sdk

[Docs](https://github.com/EvanZhouDev/openai-oauth#client-adapters) | [GitHub](https://github.com/EvanZhouDev/openai-oauth) | [npm](https://www.npmjs.com/package/@openai-oauth/ai-sdk)

Connect OpenAI OAuth credentials to the Vercel AI SDK.

```bash
npm i @openai-oauth/ai-sdk ai
```

Quickstart:

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

## Package Notes

`@openai-oauth/ai-sdk` accepts any OpenAI OAuth credential source.

Use local credentials on your own machine:

```ts
import { openaiCredentials } from "@openai-oauth/local";

const openai = createOpenAIOAuth(openaiCredentials());
```

Use browser credentials after Sign in with ChatGPT:

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

Use `@openai-oauth/react` to establish the browser credentials. See the [Sign in with ChatGPT setup](https://github.com/EvanZhouDev/openai-oauth#sign-in-with-chatgpt-setup).

API shape:

```ts
const openai = createOpenAIOAuth(credentials);

openai("gpt-5.4-mini");
openai.languageModel("gpt-5.4-mini");
```

Exports:

- `createOpenAIOAuth`
- `OpenAIOAuthProvider`
- `OpenAIOAuthProviderInput`
- `OpenAIOAuthProviderSettings`
- `OpenAIOAuthModelId`

## More

[Learn more in the openai-oauth README.](https://github.com/EvanZhouDev/openai-oauth#client-adapters)
