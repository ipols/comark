# Troubleshooting comark

The most common stumbling blocks, in roughly the order new users hit them.

## "No URL appeared in chat after I wrote a markdown file"

The hook didn't run, or it ran and bailed silently. Check, in order:

1. **Is the plugin enabled?**
   ```
   /plugin list
   ```
   `comark` should show as enabled. If not, re-run `/plugin install comark@ipols-comark`.

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

## "I left a comment and it stays 'thinking…' forever"

The listener subagent isn't picking up the comment. Most likely cause: **the listener subagent has exited** (it idle-times out after 15 minutes of no activity). Two ways to recover:

1. **Trigger a fresh listener.** Ask your chat agent to make any small edit to the doc (or write a new `.md` file). The hook fires, the agent spawns a fresh listener, and the listener immediately picks up your pending comment.

2. **Have your main chat agent answer it directly.** Your main chat agent has the same comark MCP tools the listener uses. Just ask:
   > Address the open comments on `<doc-name>`.
   The agent calls `comark_list_comments`, sees what's pending, generates an answer, and posts it via `comark_post_answer`. The browser will pick it up via SSE within seconds.

If the listener didn't even spawn in the first place (e.g., the chat agent ignored the hook envelope), check `claude --debug` output and re-trigger by writing the doc again.

## "Comments answer slowly (more than 30 seconds)"

The listener generates the answer using the same model your main chat is using. If your main chat is slow (rate-limited, complex turn in progress), the listener might be waiting in queue.

A quick way to confirm: run `/plugin list` and check the listener subagent's task is still running. If it's been stuck for minutes, your main agent's queue is busy.

If your chat session is rate-limited, the listener will retry per the platform's normal rate-limit backoff. There's nothing comark-specific to do.

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

## "The chat is using a different model from what comark used to answer"

The listener inherits whatever model your chat session is on at the time the hook fires (extracted from the transcript). If you change models mid-session and want comark to use the new one, write a fresh markdown file — the new hook captures the current model and spawns a new listener tied to it.

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

Open an issue at [github.com/ipols/comark/issues](https://github.com/ipols/comark/issues) with:
- Your platform (Mac/Linux/Windows + version)
- Node version (`node --version`)
- The relevant lines from `claude --debug` transcript when you triggered the issue
- A redacted copy of `~/.comark/server.lock` and `~/.comark/docs.json` if they exist
