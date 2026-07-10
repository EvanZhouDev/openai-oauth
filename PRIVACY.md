# OpenAI OAuth Privacy Policy

Effective date: July 10, 2026

OpenAI OAuth is an unofficial, community-maintained project. It is not affiliated with, endorsed by, or sponsored by OpenAI, Inc.

## Sign in with ChatGPT Extension

The Sign in with ChatGPT browser extension is used only to complete sign-in.

During sign-in, it redirects the local OpenAI OAuth callback at `http://localhost:1455/auth/callback` to an extension confirmation screen. The screen shows which app requested sign-in and returns you to that app only after you continue.

The extension temporarily handles the OAuth callback parameters, such as `code` and `state`, and the app URL that started sign-in. This data is not saved to extension storage and is sent only to the app you confirm.

OpenAI OAuth does not receive this data on any OpenAI OAuth server.

## Extension Permissions

The extension requests access only to `http://localhost:1455/*` so it can redirect OpenAI's local OAuth callback.

## What The Extension Does Not Do

The extension does not read ChatGPT chat history, page contents, browsing history, or passwords.

It does not sell data, use data for ads or analytics, or use data for any purpose unrelated to sign-in.

## Contact

For questions, contact evanzhoudev@gmail.com or open an issue at https://github.com/EvanZhouDev/openai-oauth/issues.
