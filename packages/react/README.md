# @openai-oauth/react

[Docs](https://github.com/EvanZhouDev/openai-oauth#react-component) | [GitHub](https://github.com/EvanZhouDev/openai-oauth) | [npm](https://www.npmjs.com/package/@openai-oauth/react)

Let your users sign in with their ChatGPT accounts.

```bash
npm i @openai-oauth/react
```

Quickstart:

```tsx
"use client";

import { SignInWithChatGPT } from "@openai-oauth/react";

export default function Page() {
	return <SignInWithChatGPT />;
}
```

## Package Notes

`SignInWithChatGPT` renders the OpenAI-style sign-in button. After sign-in, it becomes a disconnect button.

The prebuilt button includes a small "Powered by OpenAI OAuth" link by default. Pass `hideAttribution` to render only the button with no attribution link or reserved space.

The prebuilt component shows the Chrome extension screen inline when hosted web apps need it. The hook itself only exposes auth state, so custom UI users can render their own screen or reuse `SignInWithChatGPTExtensionScreen`.

Browser model calls must go through your own app route because ChatGPT does not allow direct browser CORS requests. Send the signed-in session to that route with `openaiAuthHeaders()`:

```tsx
"use client";

import { openaiAuthHeaders, SignInWithChatGPT } from "@openai-oauth/react";

async function ask() {
	const response = await fetch("/api/chat", {
		method: "POST",
		headers: await openaiAuthHeaders({
			headers: { "content-type": "application/json" },
		}),
		body: JSON.stringify({ prompt: "Hello!" }),
	});

	return response.text();
}
```

`openaiAuthHeaders()` returns a plain object, so it can be passed directly to `fetch`, AI SDK hooks, and other code that spreads header objects.

Read the request-bound credentials on your server:

```ts
import { createOpenAIOAuth } from "@openai-oauth/ai-sdk";
import { openaiCredentials } from "@openai-oauth/react/server";
import { generateText } from "ai";

export async function POST(request: Request) {
	const { prompt } = await request.json();
	const openai = createOpenAIOAuth(openaiCredentials(request));

	const result = await generateText({
		model: openai("gpt-5.4-mini"),
		prompt,
	});

	return Response.json({ text: result.text });
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

For custom UI, use the hook:

```tsx
import {
	SignInWithChatGPTExtensionScreen,
	useSignInWithChatGPT,
} from "@openai-oauth/react";

function CustomLogin() {
	const login = useSignInWithChatGPT();

	if (login.status === "signed-in") {
		return <button onClick={() => void login.logout()}>Disconnect</button>;
	}

	if (login.status === "needs-extension") {
		return <SignInWithChatGPTExtensionScreen onContinue={login.login} />;
	}

	return (
		<button onClick={() => void login.login()}>Sign in with ChatGPT</button>
	);
}
```

The hook returns:

```ts
type UseSignInWithChatGPTReturn = SignInWithChatGPTState & {
	isSignedIn: boolean;
	login(): Promise<void>;
	logout(): Promise<void>;
	refresh(): Promise<OpenAIOAuthSession | null>;
	reset(): void;
};
```

State statuses:

```ts
"checking" | "signed-out" | "starting" | "needs-extension" | "redirecting" | "signed-in" | "error"
```

The default browser session store persists encrypted sessions in IndexedDB. Apps can provide their own store:

```ts
import { createSessionStore } from "@openai-oauth/react";

const sessionStore = createSessionStore();

type SessionStore = {
	get(): Promise<OpenAIOAuthSession | null>;
	set(session: OpenAIOAuthSession): Promise<void>;
	clear(): Promise<void>;
};
```

Exports:

- `SignInWithChatGPT`
- `SignInWithChatGPTExtensionScreen`
- `useSignInWithChatGPT`
- `openaiAuthHeaders`
- `getSession`
- `createSessionStore`
- `openaiCredentials` from `@openai-oauth/react/server`

## More

[Learn more in the openai-oauth README.](https://github.com/EvanZhouDev/openai-oauth#react-component)
