# @openai-oauth/ai-sdk

Vercel AI SDK provider adapter for openai-oauth auth handles.

## Browser

```ts
import { createOpenAIOAuth } from "@openai-oauth/ai-sdk";
import { openaiCredentials } from "@openai-oauth/react";
import { generateText } from "ai";

const openai = createOpenAIOAuth(openaiCredentials());

const result = await generateText({
	model: openai("gpt-5.4"),
	prompt: "Reply with exactly: hello",
});
```

## Local

```ts
import { createOpenAIOAuth } from "@openai-oauth/ai-sdk";
import { openaiCredentials } from "@openai-oauth/local";

const openai = createOpenAIOAuth(openaiCredentials());
```

## API

`createOpenAIOAuth(input, settings?)`

Input:

```ts
type OpenAIOAuthProviderInput =
	| OpenAIOAuthTransport
	| OpenAIOAuth;

type OpenAIOAuthProviderSettings = {
	name?: string;
};
```

Output:

```ts
type OpenAIOAuthProvider = {
	(modelId: string): LanguageModelV3;
	languageModel(modelId: string): LanguageModelV3;
};
```
