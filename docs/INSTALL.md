# Installing comark

Two commands. Total time on a fresh machine: about a minute.

## Prerequisites

- **Claude Code** (CLI, Mac/Windows desktop app, web app at claude.ai/code, or IDE extension). Any of those work — the plugin is platform-agnostic.
- **Node 20 or later** on your machine. Check with `node --version`. Claude Code itself requires Node, so you almost certainly already have it. If not: install from [nodejs.org](https://nodejs.org/) or via your package manager (`brew install node`, `apt install nodejs`, `winget install OpenJS.NodeJS`).

That's the entire prerequisite list. **No Anthropic API key is needed** — `comark` uses the same Claude Code session you're already signed into for everything.

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

That's the install. There is no Step 3.

## Try it

In a Claude Code session, ask the assistant to write a substantive markdown file. Anything will do:

> Write a 1-page PRD for a feature that surfaces stalling clients to coaches, save it to `/tmp/test-prd.md`.

When the agent finishes the `Write`, you'll see something like:

> `comark review surface ready at http://localhost:8888/?doc=a1b2c3d4`
>
> _Open the URL to review. Comments you leave will be answered automatically by a background listener subagent._

The chat agent then quietly spawns a background listener using its `Agent` tool. You don't see this happen — your conversation flows normally.

Click the URL. The review surface opens in your default browser. Highlight a passage, leave a comment, press Send. Within a few seconds, the answer appears in the comment thread — the listener generated it using your same Claude session, then posted it via comark's MCP tools, and your browser tab refreshed via the SSE channel.

You can keep chatting with the main agent in parallel. The listener runs in its own context window; it doesn't compete for your main turn.

## Optional — Pin to the Code-mode preview pane

The Code-mode preview pane in Claude Code can render the same URL. There's no programmatic open API as of May 2026, so the first time you want to use it, ask the assistant:

> Open the preview pane on `http://localhost:8888/?doc=...` and pin it.

Once pinned, subsequent docs reuse the same pane (until you switch sessions or the server restarts on a new port).

## How it works under the hood

If you're curious about what's happening:

1. **Hook fires** when the agent writes a markdown file. The hook script reads the transcript to extract the chat model + recent context, spawns or reuses comark's local Node server, registers the doc, and returns an envelope with the URL + a verbatim listener prompt.

2. **Main chat agent reads the envelope** and uses its `Agent` tool with `run_in_background: true` to spawn a listener subagent. The subagent gets the listener prompt as its task. It loops on `comark_wait_for_pending_comment` (a long-poll MCP tool) and answers comments as they come in.

3. **Local server** serves the SPA from `web/dist/`, exposes `/api/docs/:id`, `/api/comments/:id`, and `/api/events?docId=…` (SSE). It maintains a shared registry at `~/.comark/docs.json` that the MCP server reads to know which sidecars to scan.

4. **MCP server** is registered in the plugin manifest. Claude Code spawns it as a stdio child process. It exposes the read+write tools (`comark_*`) that the listener subagent (and your main chat agent) use.

5. **Sidecar** at `<doc-stem>.comark.json` is the message bus. Browser writes pending comments. Listener writes assistant turns. Filesystem watch on the server pushes SSE updates to subscribed browser tabs within ~250ms of any sidecar mutation.

The listener exits cleanly after 15 minutes of no activity (configurable in the listener prompt the hook produces). If you want to answer fresh comments on an old doc and the listener has timed out, just ask your chat agent to "answer the pending comark comments" — your main agent has the same MCP tools.

## Configuration

All optional. Set as environment variables before starting Claude Code:

| Variable | Default | Effect |
|----------|---------|--------|
| `COMARK_MIN_LENGTH` | `200` | Bytes — files smaller than this don't trigger the review surface. |
| `COMARK_PORT` | `8888` | Preferred port; the server falls back to 8889…8898 if taken. |

## Uninstall

```
/plugin uninstall comark
```

To also clean up runtime state:

```sh
rm -rf ~/.comark
```

Sidecar `*.comark.json` files in your projects are left alone — remove them manually if you want.
