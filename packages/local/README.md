# @openai-oauth/local

[Docs](https://github.com/EvanZhouDev/openai-oauth#typescript-sdk) | [GitHub](https://github.com/EvanZhouDev/openai-oauth) | [npm](https://www.npmjs.com/package/@openai-oauth/local)

Access your ChatGPT account directly from TypeScript on your machine.

```bash
npm i @openai-oauth/local
```

Quickstart:

```ts
import { openaiCredentials } from "@openai-oauth/local";

const credentials = openaiCredentials();
```

Use it with a client adapter:

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

`@openai-oauth/local` reads local Codex credentials from your machine.

By default, it checks the same auth locations used by the CLI, including `~/.codex/auth.json`.

If you are not signed in locally, run:

```bash
npx openai-oauth login
```

You can also point to a specific auth file:

```ts
const credentials = openaiCredentials({
	authFilePath: "/path/to/auth.json",
});
```

Useful options:

```ts
type LocalOpenAIOAuthOptions = {
	authFilePath?: string;
	clientId?: string;
	issuer?: string;
	tokenUrl?: string;
	ensureFresh?: boolean;
	fetch?: typeof fetch;
	now?: () => Date;
	baseURL?: string;
	headers?: Record<string, string>;
	instructions?: string;
	openAIBaseURL?: string;
};
```

`openaiCredentials()` returns an `OpenAIOAuth` credential source that can be passed to any OpenAI OAuth client adapter.

## More

[Learn more in the openai-oauth README.](https://github.com/EvanZhouDev/openai-oauth#typescript-sdk)
