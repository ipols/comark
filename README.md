# comark

Markdown review companion for Claude Code. Comment on agent-generated docs in your browser, get inline LLM answers in the same comment thread, persist comments next to the source file across sessions and machine reboots.

![comark review surface](docs/screenshot.png)

## Why this exists

When the agent in your Claude Code session writes a substantive markdown file — a PRD, brainstorm, plan, learnings doc — there's no good place to leave feedback as you read. Pasting passages back into chat scrolls everything. The doc lives outside the session. The agent's next pass won't see your reactions.

`comark` fixes that. The plugin watches `Write` and `Edit` tool calls; when one targets a `.md` file above a length threshold, it surfaces a localhost URL in your chat. Click it, and a Claude-aesthetic review surface opens. Highlight a passage, leave a comment, the LLM answers in the thread, you Accept / Refuse / Continue. Your comments persist as a sidecar JSON next to the source file — no database, no hosted backend, no auth.

## Install

```sh
# 1. Add the marketplace
/plugin marketplace add iskanderpols/comark

# 2. Install the plugin
/plugin install comark@iskanderpols-comark

# 3. Set your Anthropic API key (one-time, in your shell)
export ANTHROPIC_API_KEY=sk-...
```

After this, write any markdown file ≥ 200 characters via Claude Code and you'll see a `Review at http://localhost:8888/?doc=...` URL in chat. Click to open the review surface in your default browser.

See [docs/INSTALL.md](docs/INSTALL.md) for a step-by-step walkthrough including how to find your Anthropic API key.

## How it works

| Stage | What happens |
|-------|-------------|
| **Trigger** | The plugin's `PostToolUse` hook fires on every `Write`/`Edit`. It filters to `.md` files above a length threshold (default 200 chars; override with `COMARK_MIN_LENGTH`). |
| **Server lifecycle** | The hook spawns or reuses a single local Node server (lockfile at `~/.comark/server.lock`, port 8888 with fallback through 8898). Cold-start polling ensures the URL works the moment you click it. |
| **Context capture** | The hook walks the session transcript and extracts the current chat model + a context summary (recent decisions, open questions, source files referenced) so the review-LLM has the same context as your chat agent. |
| **Review surface** | A Vite + React SPA: per-paragraph hover affordance, freeform text selection → comment popup, side-anchored thread overlays, orphans tray, light + dark themes calibrated to the Claude Desktop product aesthetic. |
| **LLM answers** | Each comment opens an SSE stream to `/api/llm/answer`. The Anthropic SDK is invoked server-side with the same model your chat session is using (when detectable from the transcript) or `COMARK_MODEL` as fallback. The answer renders inside the comment thread — never appended to your chat. |
| **Persistence** | Comments save to `<doc-stem>.comark.json` next to the source markdown (atomic write via tmp-file rename). Travels naturally with worktrees; gitignore template is below. |
| **Anchoring** | Each comment carries W3C-style `TextQuoteSelector` + `TextPositionSelector` + a `sha256` doc hash. On every load, anchors re-resolve against the current file via a port of Hypothesis's `match-quote` algorithm. Score ≥ 0.85 attaches silently; 0.55–0.85 marks "approximate"; below 0.55 surfaces in an orphans tray with a re-anchor affordance. |

## Configuration

All configuration is environment variables — no UI, no config files.

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | *(required)* | Your Anthropic API key — used server-side when answering comments. |
| `COMARK_MIN_LENGTH` | `200` | Minimum file size in bytes for the trigger to fire. |
| `COMARK_PORT` | `8888` | Preferred port; falls back through 8888–8898 if taken. |
| `COMARK_MODEL` | `claude-sonnet-4-6` | Fallback model when the transcript-extracted model is unavailable. |

## What gets stored where

| Path | Contents | Lifecycle |
|------|----------|-----------|
| `<doc>.comark.json` | All comments + threads + anchors for that doc. | Travels with the source file. **Add `*.comark.json` to your project's `.gitignore` if you don't want to commit reviews.** |
| `~/.comark/server.lock` | Running server's PID + port. | Cleaned up automatically on shutdown; deleted if stale on next start. |

`comark` does not modify your source `.md` files. The agent's writes touch them; the plugin only observes.

## Privacy

- Comments are local-only. Nothing is sent anywhere except:
- Each LLM call sends `(doc content, your selection, your comment, the captured context summary)` to the Anthropic API. HTML comments are stripped from the doc before the call (prompt-injection mitigation).
- No telemetry. No auto-updates. The local server binds to `127.0.0.1` only and validates the `Origin` header on all state-mutating endpoints.

## Recommended `.gitignore` snippet for your projects

```gitignore
# comark — review state lives next to source markdown
*.comark.json
.comark/
```

## Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md). Common issues:

- **No URL appeared in chat** → check `/plugin list` shows comark enabled; check the file is ≥ 200 chars.
- **Port already taken** → `export COMARK_PORT=9000`.
- **`ANTHROPIC_API_KEY not set`** → set the env var in your shell, then start a new Claude Code session.
- **Preview pane doesn't auto-open** → expected; ask Claude to "open the preview pane on `<URL>`" once per session.

## Development

```sh
# clone
git clone https://github.com/iskanderpols/comark.git
cd comark
npm install

# run server tests
node --test server/test/*.test.js

# build the SPA
cd web && npm install && npm run build

# run the server directly
node server/index.js
```

The plugin manifest, hook script, server, and built SPA all ship together — there's no separate build step beyond `vite build`.

## License

MIT. Includes a port of Hypothesis client's `match-quote` algorithm under BSD-2-Clause. See [LICENSE](LICENSE).

## Acknowledgments

- [Hypothesis](https://web.hypothes.is/) — the fuzzy-anchor algorithm that makes comments survive doc rewrites is a port of their production implementation.
- [Anthropic Claude Code](https://docs.claude.com/en/docs/claude-code/) — the plugin platform this is built on.
