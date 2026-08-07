# Agent

A ChatGPT-style coding agent that runs on your own ChatGPT account — no API key,
no per-token bill. Sign in with ChatGPT, pick any model your account can reach
(including the ones OpenAI has not publicly listed yet), and hand it a task.

It plans, writes files, runs them in a sandbox terminal, searches the web and
reports back — there is no "agent mode" switch, because the agent is the
product.

```bash
bun install
bun run build                # builds the workspace packages
bun run --cwd apps/agent dev # http://localhost:3001
```

The dev and start scripts bind `0.0.0.0` and honour `$PORT`, so Replit,
Codespaces and similar hosts can reach the app.

On Replit, the Run button is preconfigured (`.replit` at the repo root) to
install, build and start this app on the port Replit assigns.

**On a hosted URL, sign-in needs the browser extension.** ChatGPT's OAuth
handoff only completes locally on its own; anywhere else it goes through the
open-source [Sign in with ChatGPT extension](https://chromewebstore.google.com/detail/sign-in-with-chatgpt/odbgboachaefbbbdiffcefhpkekhfcna).
The app detects this and shows an install screen with a continue button —
running locally needs no extension at all.

## What it does

| Capability | How it works |
| --- | --- |
| **Every model on your account** | `GET /api/models` reads the live Codex catalog on each page load, skipping the filter that normally keeps non-public entries out. Models the catalog marks `visibility: "hide"` appear under *Hidden & unlisted* — in practice that is often a superseded model rather than an upcoming one. Nothing is hard coded, so whatever OpenAI serves your account and client version is what you get. |
| **Plans without being asked** | The agent calls `update_plan` before multi-step work; the plan renders as a live checklist that ticks itself off. |
| **Writes real files** | `write_file`, `edit_file`, `read_file`, `list_files`, `delete_path`, all confined to the conversation's workspace directory. |
| **Sandbox terminal, with internet** | `run_command` runs shell commands in that directory with a timeout and captured output. The sandbox inherits the host's network settings, so `git clone`, `npm install` and `pip install` all work. This is how it tests the code it writes. |
| **Clones and runs repositories** | `clone_repo` pulls a public repo into the workspace; the agent then reads, runs and edits it in place. |
| **Fixes its own failures** | A non-zero exit comes back flagged as work to do, and the prompt tells the agent to diagnose and re-run until it passes rather than reporting the error. |
| **Web search** | `web_search` and `fetch_url` — DuckDuckGo by default, no key needed. |
| **Images** | Generate with the composer's image button or the `generate_image` tool; images are saved into the workspace. |
| **Uploads** | Drop or paste files and images. They are saved into the workspace so the agent can open them, and images are also sent to the model for vision. |
| **Roles & system prompt** | Nine role presets, or write your own system prompt, plus a reasoning-effort control. |
| **Chat history** | Stored in the browser, searchable, renameable, grouped by date. |
| **Everything is downloadable** | Any single file from the file panel, the whole workspace as a `.zip`, the current chat as Markdown, or every chat as JSON for backup. |

## Configuration

All optional.

| Variable | Effect |
| --- | --- |
| `AGENT_WORKSPACE_ROOT` | Where sandbox directories live. Default `.agent-workspace` in the app's working directory. |
| `AGENT_SANDBOX_COMMAND` | The launcher for `run_command`, default `bash -lc`. Point it at a container or jail to harden the terminal, e.g. `firejail --quiet bash -lc`. |
| `CODEX_BASE_URL` | Points the provider at a different Codex-compatible upstream — a local proxy, or a stub when testing. Defaults to the real endpoint. |
| `CODEX_CLIENT_VERSION` | Pin the Codex client version used when asking for the model catalog. Defaults to the latest published `@openai/codex`. |
| `BRAVE_SEARCH_API_KEY` / `TAVILY_API_KEY` / `SEARXNG_URL` | Use a real search API instead of scraping DuckDuckGo. First one set wins. |

## How it is wired

```
browser ──(ChatGPT OAuth headers)──▶ /api/chat ──▶ @openai-oauth/ai-sdk ──▶ Codex
   │                                    │
   │                                    └── tools: files · terminal · search · images
   └── history + credentials stay in the browser (IndexedDB, encrypted)
```

The server never stores a token. Each request carries the visitor's own OAuth
credentials, which `openaiCredentials(request)` turns into a provider for that
one call.

## Security

The important caveat, stated plainly: **the file tools are jailed, the terminal
is not.**

- File tools resolve every path against the conversation's workspace root and
  reject anything that escapes it, including via symlinks.
- `run_command` runs a real shell process on the server, as the server's user,
  with a minimal environment (nothing from `process.env` except `PATH`) and a
  timeout. A command can still read paths outside the workspace, and a blocklist
  only stops the obviously destructive ones.
- Therefore: run this locally, or deploy it in a container that you would be
  comfortable handing to a stranger, and set `AGENT_SANDBOX_COMMAND` if you want
  real isolation.
- Workspace files are served back with `Content-Type: text/plain` for HTML and
  SVG so generated markup cannot execute on this origin.
