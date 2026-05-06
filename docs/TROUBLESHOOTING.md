# Troubleshooting comark

The most common stumbling blocks, in roughly the order new users hit them.

## "No URL appeared in chat after I wrote a markdown file"

The hook didn't run, or it ran and bailed silently. Check, in order:

1. **Is the plugin enabled?**
   ```
   /plugin list
   ```
   `comark` should show as enabled. If not, re-run `/plugin install comark@iskanderpols-comark`.

2. **Is the file long enough?**
   The default threshold is 200 bytes. Verify the file size:
   ```sh
   wc -c <your-file.md>
   ```
   If it's smaller, either expand it or lower the threshold:
   ```sh
   export COMARK_MIN_LENGTH=50
   ```

3. **Is the file extension `.md`?**
   The hook only fires on `.md` / `.mdx` / `.markdown` paths.

4. **Does the hook have execute permission?**
   ```sh
   ls -la $(claude plugin path comark)/bin/comark-hook.js
   ```
   The file should be executable (`-rwxr-xr-x`). If not:
   ```sh
   chmod +x $(claude plugin path comark)/bin/comark-hook.js
   ```

5. **Run Claude Code with debug logging.**
   ```sh
   claude --debug
   ```
   Then re-trigger. You'll see hook stdout/stderr in the transcript. Look for lines starting with `comark hook:`.

## "comark could not start its review server" / port issues

All ports in 8888–8898 are taken. Free one up, or pick a different port:

```sh
export COMARK_PORT=9000
```

Then trigger another `.md` write. The new port appears in the URL.

To find what's holding 8888:

```sh
# Mac / Linux
lsof -i :8888

# Windows
netstat -ano | findstr :8888
```

## "ANTHROPIC_API_KEY is not set" — error inside the comment thread

The plugin server is running but couldn't find your API key. Two common causes:

1. **The variable isn't exported in your shell environment.**
   ```sh
   echo $ANTHROPIC_API_KEY
   ```
   If empty, set it and add to your shell profile (`~/.zshrc`, `~/.bashrc`):
   ```sh
   export ANTHROPIC_API_KEY=sk-ant-...
   ```

2. **You set it after starting Claude Code.**
   Environment variables are inherited at process start. Start a new Claude Code session after setting the variable.

The error message is intentionally generic — the plugin never logs your API key, even on failure.

## "Rate limited by the Anthropic API"

You've exceeded your tier's per-minute or daily token quota. Options:

- Wait a few minutes and retry (the comment thread shows a Retry button in the error state).
- Upgrade your Anthropic plan at [anthropic.com/pricing](https://www.anthropic.com/pricing).
- Use a smaller model:
  ```sh
  export COMARK_MODEL=claude-haiku-4-5-20251001
  ```
  Note this only affects the *fallback* model; if the hook captures a model from your chat session, that one wins.

## "Cannot reach api.anthropic.com"

Network problem. Check:

```sh
curl -v https://api.anthropic.com/
```

If unreachable, you're likely behind a firewall, VPN, or offline. comark has no offline mode for the LLM call.

## Code-mode preview pane doesn't open automatically

Expected. Claude Code does not expose a programmatic preview-pane API as of May 2026. Workaround: ask the assistant once per session:

> "Open the preview pane on `http://localhost:8888/?doc=...` and pin it."

The pin survives until:
- You start a new Claude Code session, OR
- The comark server restarts on a different port (e.g. after a reboot), in which case the pinned URL becomes stale and you need to ask again.

The browser tab is always available as the default — clicking the URL opens it in your default browser regardless of what the preview pane is doing.

## "I rewrote the doc and my comments disappeared"

They're orphaned, not deleted. Look for the orange "N orphans" chip at the bottom-right corner of the review surface. Click it to expand the orphans tray. For each orphan you see:

- The original quoted text
- The thread you had on it
- Two buttons: **Re-anchor here** (click, then click or select the new location in the doc), or **Dismiss**

Sidecar JSON is never deleted automatically — only the user's `Dismiss` action removes a comment.

## Sidecar got out of sync / corrupted

If `<doc>.comark.json` becomes invalid JSON, the server detects this on next load, archives the broken file as `<doc>.comark.json.bak.<timestamp>`, and starts fresh with no comments. You can:

- Recover from the `.bak.<timestamp>` file by hand-editing valid JSON, OR
- Just leave it; new comments build a fresh sidecar.

## "I want a different LLM"

`COMARK_MODEL=claude-sonnet-4-6` (or any other Anthropic model ID) sets the fallback. The default is whatever model your chat session is using when reliably detectable from the session transcript.

There's no support for other LLM providers in V1. Adding OpenAI / Gemini / etc. is a possible follow-up but not on the V1 roadmap.

## How to reset everything

```sh
# Stop the server
kill $(cat ~/.comark/server.lock | jq -r .pid) 2>/dev/null

# Clear runtime state
rm -rf ~/.comark

# Optional: remove sidecars in a project
find <your-project> -name '*.comark.json' -delete
```

## Still stuck?

Open an issue at [github.com/iskanderpols/comark/issues](https://github.com/iskanderpols/comark/issues) with:
- Your platform (Mac/Linux/Windows + version)
- Node version (`node --version`)
- The relevant lines from `claude --debug` transcript when you triggered the issue
- A redacted copy of `~/.comark/server.lock` if it exists
