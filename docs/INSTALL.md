# Installing comark

A two-command install plus one environment variable. Total time on a fresh machine: about 3 minutes.

## Prerequisites

- **Claude Code** (CLI, Mac/Windows desktop app, web app at claude.ai/code, or IDE extension). Any of those work — the plugin is platform-agnostic.
- **Node 20 or later**. Check with `node --version`. If you don't have it, install via [nodejs.org](https://nodejs.org/) or your package manager (`brew install node`, `apt install nodejs`, `winget install OpenJS.NodeJS`).
- **An Anthropic API key**. See [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys). The free tier is sufficient for normal review use.

## Step 1 — Add the plugin marketplace

In any Claude Code session:

```
/plugin marketplace add iskanderpols/comark
```

This registers the GitHub repo as a plugin marketplace source. It's idempotent — running it again is a no-op.

## Step 2 — Install the plugin

```
/plugin install comark@iskanderpols-comark
```

You'll see a confirmation that the plugin is enabled. Verify with:

```
/plugin list
```

`comark` should appear with version and "enabled" status.

## Step 3 — Set your Anthropic API key

In your shell (NOT inside Claude Code):

```sh
# Mac / Linux (zsh, bash) — add to ~/.zshrc or ~/.bashrc to persist
export ANTHROPIC_API_KEY=sk-ant-...

# Windows (PowerShell)
$env:ANTHROPIC_API_KEY = "sk-ant-..."
```

After setting it, **start a new Claude Code session** so the variable propagates into the plugin process.

To get an API key: go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys), click "Create Key", copy the value (starts with `sk-ant-`). The Anthropic API has a generous free tier and pricing for paid tiers is at [anthropic.com/pricing](https://www.anthropic.com/pricing).

## Step 4 — Try it

In a Claude Code session, ask the assistant to write a substantive markdown file. Anything will do:

> Write a 1-page PRD for a feature that surfaces stalling clients to coaches, save it to `/tmp/test-prd.md`.

When the agent finishes the `Write`, you'll see a line like:

> `comark review surface ready at http://localhost:8888/?doc=a1b2c3d4...`
>
> `Model used for inline answers: claude-opus-4-7.`

Click the URL. The review surface opens in your default browser. Highlight a passage, leave a comment, watch the LLM answer stream into the thread.

## Optional — Pin to the Code-mode preview pane

The Code-mode preview pane in Claude Code can render the same URL. There's no programmatic open API as of May 2026, so the first time you want to use it, ask the assistant:

> Open the preview pane on `http://localhost:8888/?doc=...` and pin it.

Once pinned, subsequent docs reuse the same pane (until you switch sessions or the server restarts on a new port).

## Configuration

All optional. Set as environment variables before starting Claude Code:

| Variable | Default | Effect |
|----------|---------|--------|
| `COMARK_MIN_LENGTH` | `200` | Bytes — files smaller than this don't trigger the review surface. |
| `COMARK_PORT` | `8888` | Preferred port; the server falls back to 8889…8898 if taken. |
| `COMARK_MODEL` | `claude-sonnet-4-6` | Fallback LLM if the transcript-extracted model is unavailable. |

## Uninstall

```
/plugin uninstall comark
```

To also clean up runtime state:

```sh
rm -rf ~/.comark
```

Sidecar `*.comark.json` files in your projects are left alone — remove them manually if you want.
