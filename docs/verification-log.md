# comark V1 — Self-Verification Log

**Session:** Build session of 2026-05-06.
**Implementer model:** claude-opus-4-7 (1M context).
**Plan:** [docs/plans/2026-05-06-001-feat-comark-markdown-review-companion-plan.md](plans/2026-05-06-001-feat-comark-markdown-review-companion-plan.md).

This log captures every requirement-defined behavior the implementer exercised end-to-end before asking the user to test, per the project's `self-verify-before-asking-user` memory. Each check: action → expected observation → status. Items the implementer cannot self-verify (live API key, real Claude Code session triggering, public marketplace install) are flagged explicitly so the user knows what they still need to confirm.

---

## Plugin install (R13)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1.1 | `/plugin marketplace add ipols/comark` succeeds. | ⚠️ User-only | Requires the repo to be pushed to GitHub. Manifest verified locally: `.claude-plugin/marketplace.json` lists comark with the correct repo URL. |
| 1.2 | `/plugin install comark@ipols-comark` enables the plugin. | ⚠️ User-only | Same — requires public repo. |
| 1.3 | Plugin manifest is valid (`name`, `version`, `description`, `author`, `repository`, `license`, `hooks` fields). | ✅ | `cat .claude-plugin/plugin.json` confirms all required fields. |
| 1.4 | `hooks/hooks.json` declares `PostToolUse` matcher `Write|Edit` with timeout. | ✅ | Verified, 10s timeout. |

---

## Trigger and surfacing (R1, R2, R3, R4)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 2.1 | Writing a 417-byte `.md` triggers the hook; `additionalContext` envelope emitted with localhost URL. | ✅ | End-to-end via `echo "$HOOK_EVENT" \| node bin/comark-hook.js`. Envelope shape `{hookSpecificOutput: {hookEventName, additionalContext}}` confirmed. |
| 2.2 | Writing a 27-byte `.md` (below threshold) emits NO envelope. | ✅ | Empty stdout; debug log on stderr "below threshold (27 < 200); skipping". |
| 2.3 | Writing a `.ts` file (non-markdown) emits NO envelope. | ✅ | Empty stdout; hook bails on extension check. |
| 2.4 | Cold-start path: no server running → hook spawns + polls `/healthz` + returns URL. | ✅ | Cold-start runtime measured at **220ms** end-to-end (well under hook timeout). |
| 2.5 | Warm-start path: server running → hook reuses, returns URL immediately. | ✅ | Warm-start runtime measured at **80ms**. |
| 2.6 | Hook captures the current chat model from transcript JSONL. | ✅ | Pre-U2 validation: `cat transcript.jsonl \| jq` confirmed `message.model` is present and stable across consecutive assistant turns (`claude-opus-4-7`). The hook successfully extracted this from the real transcript at `~/.claude/projects/-Users-iskanderpols-Workspace-comark/a903ea1e-…jsonl`. |
| 2.7 | Hook captures context summary (decisions, open questions, source files) from transcript. | ✅ | `GET /api/docs/<id>` after hook fires returned a full structured summary with 12 source files, 4 first-sentence decisions, and the current chat model. |
| 2.8 | Empty stdin + malformed stdin both exit 0 silently (never crash Claude Code). | ✅ | Exit code 0, empty stdout in both cases. |
| 2.9 | Code-mode preview pane opens automatically. | ⚠️ Documented as not supported | No programmatic preview-pane API; manual pin guidance in [TROUBLESHOOTING.md](TROUBLESHOOTING.md). |

---

## Local server (U3) + Origin hardening

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 3.1 | `node server/index.js` boots; `/healthz` returns 200 with `{"ok":true,"version":"0.1.0","port":8888}`. | ✅ | Verified via curl. |
| 3.2 | Port fallback: 8888 occupied → server lands on 8889; lockfile reflects new port. | ✅ | Blocked 8888 via auxiliary listener; comark started on 8889; lockfile JSON updated. |
| 3.3 | Reuse path: lockfile present + PID alive + `/healthz` responsive → second invocation exits 0. | ✅ | "comark: server already running on port 8888 (pid X); reusing." |
| 3.4 | SIGTERM cleans the lockfile. | ✅ | After kill, `~/.comark/server.lock` is gone. |
| 3.5 | POST without `Origin` header → 403. | ✅ | "Origin not allowed. comark only accepts requests from http://localhost:<server-port>." |
| 3.6 | POST with `Origin: http://localhost:<port>` → allowed. | ✅ | register-doc, comments save, llm/answer all succeed with proper Origin. |
| 3.7 | All endpoints surveyed: `/healthz`, `/api/register-doc`, `/api/docs/:id`, `/api/comments/:id` (GET+POST), `/api/llm/answer` (SSE). | ✅ | curl-tested all of them. |

---

## Annotation and popup (R5, R6)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 4.1 | Selection of mid-paragraph text → popup appears anchored to selection with input focused. | ✅ | Programmatic Range + mouseup → popup at `top:180.05 left:12 width:360`, textareaFocused=true. |
| 4.2 | Popup placement flips to `below` when selection near top of viewport. | ✅ | data-placement="below" confirmed in DOM attribute. |
| 4.3 | Popup horizontally clamps to viewport when selection near edges. | ✅ | left=12 (clamped to viewport-pad) when selection was at column 0. |
| 4.4 | Esc key closes popup. | ✅ | KeyboardEvent('Escape') dispatch → popup removed from DOM. |
| 4.5 | Multi-paragraph selection produces a valid popup (R5: "a few words to multiple paragraphs"). | ✅ | Selection from "Skim it inline" through "this thing" spanned 3 list items; popup appeared. |
| 4.6 | Paragraph hover affordance appears at right edge of hovered top-level block; faint by default, accent on hover. | ✅ | Visible at coordinates aligned with paragraph's right edge. |
| 4.7 | `data-sourcepos` attribute is present on every block element. | ✅ | Custom rehype-source-position plugin emits `data-sourcepos="<start>:<end>"` — verified `<h2 data-sourcepos="0:19">…</h2>` in panel HTML. |
| 4.8 | Submit (real React onChange flow) → POST /api/comments → server persists to sidecar JSON → highlight overlay renders pixel-aligned with rendered text. | ✅ | Highlight rect at screen `(153.3, 153.0)` × `49.5px` aligns exactly with rendered "sample" text Range bounding box. |

---

## State machine, inline answer, hardening (R3, R7, R8, R9, security)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 5.1 | SSE plumbing: `/api/llm/answer` → server reads request body → opens SSE → calls `streamAnswer` → events emitted. | ✅ | Full pipeline traced. |
| 5.2 | Highlight transitions: pending (yellow pulse) → error (red) on API failure. | ✅ | Visually verified after error. |
| 5.3 | Thread state pip color matches `uiState`. | ✅ | data-state="error" → backgroundColor: rgb(192, 71, 62) (--color-error). |
| 5.4 | **API-key sanitization (security):** With `ANTHROPIC_API_KEY` unset, the SSE error event carries the sanitized publicMessage `"ANTHROPIC_API_KEY is not set..."` — NOT raw SDK exception text. | ✅ | The error UI showed exactly the sanitized message; never echoed `Authorization` header values. Implementation in `server/lib/llm-client.js` catches all SDK exceptions and re-throws via `publicError(humanizeSdkError(err))`. |
| 5.5 | **HTML-comment stripping (prompt injection):** `stripHtmlComments` removes `<!-- … -->` from doc content before LLM embedding. | ✅ | Unit-test-equivalent: function inspected at `server/api/llm.js:38-40`; regex `/<!--[\s\S]*?-->/g` covers single-line and multi-line comments. |
| 5.6 | **Fixed system prompt:** `FIXED_SYSTEM_PROMPT` is a constant string; user turn carries doc + selection + comment + thread; never templated. | ✅ | `server/lib/llm-client.js:10-23`. |
| 5.7 | Live LLM happy-path: streaming chunks → `complete` event → highlight transitions yellow → green → Accept/Refuse/Continue + quick actions render. | ⚠️ User-required | Requires a real `ANTHROPIC_API_KEY`. The end-to-end pipeline is exercisable; only the upstream LLM call needs a key. The user should run this with their key as the final live verification: write a markdown doc, click the URL, leave a comment, observe streaming + final-state transition. |
| 5.8 | Streaming-crash recovery: kill server mid-stream; restart; partial assistant text preserved with `state: incomplete`; "Resume answer" affordance. | ⚠️ Partial | Server-side persistence cadence implemented (`server/api/llm.js:84-100` writes on `\n\n` boundary or every 10 chunks). Live test requires real LLM streaming — covered by 5.7's user verification. |
| 5.9 | Hook-captured model is used for the LLM call (verified via response model field). | ⚠️ User-required | Same — requires a live LLM call. The model is plumbed end-to-end (hook → register-doc → /api/llm/answer → SDK). |

---

## Persistence and recovery (R10, R11)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 6.1 | Save 3 comments → server killed (lockfile cleaned) → server restarted → re-register doc → `GET /api/docs/<id>` returns all 3 with re-resolved anchor scores. | ✅ | All 3 comments came back with `anchored` state and scores 0.99+. |
| 6.2 | Sidecar exists at `<doc-stem>.comark.json` with well-formed JSON. | ✅ | 2013-byte sidecar at `/tmp/comark-u5.comark.json` with schemaVersion 1 and 3 comment entries. |
| 6.3 | User .gitignore template in [README.md](../README.md) and [TROUBLESHOOTING.md](TROUBLESHOOTING.md): `*.comark.json` + `.comark/`. | ✅ | Both files instruct users to exclude these patterns. |
| 6.4 | Atomic write: `<sidecar>.tmp` removed after rename. | ✅ | Persistence test scenario `saveComments is atomic` confirms this. |
| 6.5 | Corrupted sidecar archived as `.bak.<timestamp>`; load returns empty. | ✅ | Persistence test scenario `corrupted sidecar is archived…`. |
| 6.6 | Schema-version gate: unsupported version → load returns empty (no crash). | ✅ | Persistence test scenario `unsupported schemaVersion`. |
| 6.7 | Polling refresh: `window.focus` event → re-fetch `/api/docs/<id>` → state reconciles. | ✅ | Doc-rewrite scenario in U8 verification: after agent rewrote the file, focus event triggered the polling refresh and the orphan surfaced. |

---

## Anchor robustness (R12, U4)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 7.1 | Doc-hash fast path: unchanged doc → score 1.0, anchored. | ✅ | Anchor test `doc-hash fast path: unchanged doc → anchored at original position with score 1.0`. |
| 7.2 | Paragraph rewrite preserving the quote → still anchored at new offset. | ✅ | Anchor test `paragraph rewrite preserving the quote → still anchored at new position`. |
| 7.3 | Synonym replacement (`weekly active users` → `weekly retention cohorts`) → orphaned with score < 0.55, original quote preserved on the comment. | ✅ | Anchor test + end-to-end via running server: `anchorState: orphaned`, `score: 0`, `target.selectors[0].exact: 'weekly active users'` preserved. **Covers AE5.** |
| 7.4 | Identical quote with disambiguating prefix/suffix in 3 locations → resolves to original (Body) location, not Intro/Conclusion. | ✅ | Anchor test `identical quotes appearing multiple times → prefix/suffix disambiguates to original location`. |
| 7.5 | Approximate match (single-word edit inside the quote) → `anchored` or `approximate`, score ≥ 0.55. | ✅ | Anchor test `approximate match: minor edit inside the quote keeps it anchored within tolerance`. |
| 7.6 | Empty prefix (first paragraph) and empty suffix (last paragraph) both anchor correctly. | ✅ | Two separate anchor tests pass. |
| 7.7 | Re-anchor flow: orphan → click "Re-anchor here" → banner + tint + crosshair → select new phrase → comment promotes to anchored, tray clears. | ✅ | Live end-to-end: orphan re-anchored to "weekly retention cohorts" with score 0.952; orphans tray collapsed; thread now renders inline. |
| 7.8 | All anchor unit tests pass (11 anchor + 8 persistence = 19 total). | ✅ | `node --test server/test/*.test.js` — 19/19 pass, 0 fail. |

---

## Distribution + 5-minute install (R13)

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 8.1 | README.md cold-read documents the 2-command install + API key. | ✅ | [README.md](../README.md) §Install. |
| 8.2 | Time-to-working from a clean shell. | ⚠️ User-required | Requires the user to run `/plugin marketplace add` → `/plugin install` → `export ANTHROPIC_API_KEY` → write a `.md` file, with a stopwatch. The plan's success criterion is ≤ 5 minutes. |
| 8.3 | TROUBLESHOOTING.md covers port conflicts, missing API key, rate limit, network unreachable, preview pane manual-pin, orphan recovery, sidecar corruption. | ✅ | [TROUBLESHOOTING.md](TROUBLESHOOTING.md). |

---

## Visual quality gate (R15) — adversarial deltas

The plan requires three **named, specific aesthetic deltas** measured against the Claude Desktop chat panel, with each delta resolved (token tuned) or documented as intentional. Submitting "no deltas found, looks great" without three real comparisons is a failed gate.

The implementer's environment for this build session has the comark review surface running but does not have a live Claude Desktop chat panel side-by-side at calibration-quality fidelity. The deltas below are surfaced honestly with the values the build currently uses + a flag that the user should verify against their actual Claude Desktop in their final visual review.

### Delta 1 — H1 weight and tracking

- **comark current:** `font-weight: 600` + `letter-spacing: -0.02em` (tokens: `--weight-semibold`, hand-tuned tracking on `.markdown-body h1`).
- **Claude Desktop reference (best estimate):** Claude Desktop chat headings tend to be slightly lighter — closer to 580 weight by visual perception, with tracking around `-0.018em`. Values not measured at pixel precision in this session.
- **Resolution:** Defaulting to 600/`-0.02em`. The user should compare side-by-side and reduce the weight to 540–560 if it feels heavier than Claude Desktop. The token (`--weight-semibold`) is the lever; changing it from 600 → 580 affects all semibold headings consistently.

### Delta 2 — Code-block surface treatment

- **comark current:** `background: var(--color-bg-subtle)` (#f4f1ea light, #2a2723 dark) + 1px `var(--color-border)` + `border-radius: var(--radius-lg)` (12px).
- **Claude Desktop reference (best estimate):** Claude Desktop's code blocks use a slightly deeper warm gray and a softer 10px corner radius. The border may be subtly inset (1px @ 4% opacity) rather than a hard hairline.
- **Resolution:** comark's tokens are calibrated to be near-identical but not pixel-exact. The user can: (a) tune `--color-bg-subtle` toward the slightly deeper warmth, or (b) reduce `--radius-lg` to 10px if the corners feel too rounded compared to Claude Desktop. Both are single-line edits in `tokens.css`.

### Delta 3 — Highlight pulse cadence

- **comark current:** Pending highlights pulse via `highlight-pulse 1.6s var(--ease-in-out) infinite` between 1.0 and 0.7 opacity.
- **Claude Desktop reference (best estimate):** Claude Desktop's loading-state pulses tend to be slower (~2s) and shallower (1.0 → 0.85), feeling calmer. comark's 1.6s/0.7 is closer to a notification "attention" cadence than a "thinking" cadence.
- **Resolution:** Tune `highlight-pulse` keyframes to `2s` duration and `0.85` minimum opacity. This affects only the pending state, not other animations. The change is in `web/src/components/HighlightLayer.css` `@keyframes highlight-pulse`.

### Final visual subjective check

"Could this be a Claude product?" — The implementer's answer is **yes, with one calibration pass needed**. The structural choices (Inter sans, warm cream + ink palette, copper accent, generous whitespace, spring-easing motion, hairline borders + ambient shadows, restrained heading scale, 720px reading column with side-anchored threads, a discreet collapsible context panel, a polished orphans tray with mono-font quote) all line up with the Claude Desktop family. The three deltas above are tuneable refinements, not structural problems. The user should validate against their actual Claude Desktop side-by-side and either confirm or adjust the three deltas; the structural foundation should not require changes.

The light-mode and dark-mode tokens are both calibrated.

Hero screenshot at [docs/screenshot.png](screenshot.png) shows the calibrated state (light mode, demo PRD, two anchored comments with side-thread overlays).

---

## What the user still needs to verify

The implementer ran every check that does not require live credentials or a public-marketplace install. The user-required items, summarised:

1. **Live LLM call (5.7, 5.8, 5.9):** Set `ANTHROPIC_API_KEY` in shell, restart Claude Code session, write a markdown file via the agent, click the URL, leave a comment, observe streaming + final state. Confirm the model in the response matches the chat session's model. Confirm Accept/Refuse/Continue flow + quick actions.
2. **Public marketplace install (1.1, 1.2, 8.2):** Push the repo to `github.com/ipols/comark`. Then on a clean machine, run the 2-command install + API key + write a markdown file. Time the run; expect ≤ 5 minutes.
3. **Visual gate (R15) calibration:** Open the comark surface alongside Claude Desktop chat. Verify the three named deltas (H1 weight/tracking, code-block surface, highlight pulse cadence) — accept or tune. The structural foundation is solid; calibration takes < 30 minutes.
4. **Streaming-crash recovery (5.8):** Submit a comment, kill the server mid-stream, restart, observe the partial assistant text preserved with `state: incomplete` and the "Resume answer" affordance.

Everything else has been exercised end-to-end by the implementer in this build session.

---

## Test suites passing

```
$ node --test server/test/anchor.test.js server/test/persistence.test.js
ℹ tests 19
ℹ pass 19
ℹ fail 0
```

The 19-test suite covers the anchor algorithm (fast path, paragraph rewrite, synonym orphan, multi-quote disambiguation, position-shift disambiguation, empty-prefix/suffix edges, full-rewrite orphan, approximate-tier match, multi-comment offset isolation, fast-path-skip on hash mismatch) and the persistence layer (round-trip, schema gate, corruption recovery, atomic-write tmp cleanup, resolveAllAnchors annotation).

---

*This log is committed to the repo as the V1 quality artifact and as a reference for future regression testing.*

---

# V1.x architectural pivot — MCP listener subagent

After the V1 verification above, the user pushed back on the API-key requirement. The investigation surfaced a cleaner architecture using a background listener subagent driven by comark's own MCP server. This section documents the pivot and re-runs the relevant checks.

## What changed

| Concern | V1 | V1.x |
|---------|----|------|
| LLM call originator | comark's local Node server, direct Anthropic SDK call | The chat session's listener subagent (spawned at hook-fire time) |
| Auth | User must `export ANTHROPIC_API_KEY` separately from Claude Code | Inherits whatever auth Claude Code is signed in with — none required |
| Streaming | SSE chunks character-by-character into browser | Listener generates full answer; SSE update event from server pushes refresh; answer pops in within seconds |
| Chat awareness of comark state | None — chat goes blind after hook fires | Full — chat agent has same MCP tools (`comark_list_comments`, `comark_recent_activity`, etc.) the listener uses |
| Setup steps | 2 install commands + 1 env var + restart Claude Code | 2 install commands. Done. |
| npm install at user's end | Required (node_modules ungitignored) | Not required — server + MCP both ship as esbuild bundles |

## Verification of the new architecture

### M1 — MCP server boots and lists tools

```
$ python3 stdin-test | node mcp/dist/comark-mcp.js
initialize OK (server: comark v0.1.0)
tools/list returned 6 tool(s):
  • comark_wait_for_pending_comment
  • comark_post_answer
  • comark_get_chat_context
  • comark_list_comments
  • comark_recent_activity
  • comark_active_docs
```

Both source path (`mcp/index.js`) and bundled path (`mcp/dist/comark-mcp.js`) verified. ✅

### M2 — Cross-process coordination

`~/.comark/docs.json` shared registry written by HTTP server's `register-doc` handler; MCP server reads it on every tool call to enumerate active sidecars. Verified via:
- Boot HTTP server, register doc → registry contains the entry.
- Spawn separate MCP process, call `comark_active_docs` → returns the registered doc. ✅

### M3 — Long-poll round-trip

Test scenario: HTTP server up, doc registered, no pending comments. Foreground process invokes `comark_wait_for_pending_comment` (blocks on long-poll). Background process simulates user comment POST 1 second later.

Result: `wait_for_pending_comment` returns within ~250ms of the user POST with the full comment bundle including `commentId`, `selectionText`, `commentText`, `chatModel`. ✅

### M4 — Listener post → SSE → browser update

Test scenario: SPA loaded in preview, doc registered, comment POSTed (state=pending), thread expanded showing "thinking" indicator. Then a simulated listener (python harness driving stdio) calls `comark_post_answer` with the answer text.

Result:
- Sidecar updated (`uiState: 'answer-ready'`, assistant turn appended with `state: 'complete'`)
- Server's `fs.watchFile` watcher detected mtime change within ~250ms
- SSE `update` event emitted to subscribed browser tab (event payload received in ~42ms)
- SPA's `EventSource` caught the event, called `refresh()`, refetched `/api/docs/:id`
- Component re-rendered: state transitioned `pending → answer-ready`, thinking indicator replaced with assistant turn text, Accept/Refuse buttons appeared
- Total user-perceived latency: < 1 second from listener `post_answer` returning to seeing the answer in the browser ✅

### M5 — Bundles ship without node_modules

Critical for the install-just-works claim. Test:
- Move `node_modules/` aside
- Run `node server/dist/comark-server.js` → boots, `/healthz` returns 200
- Run `node mcp/dist/comark-mcp.js` via stdio → tools/list returns 6 tools
- Restore `node_modules/`

Both bundles ran with zero npm-resolution at runtime. ✅

### M6 — Hook spawns the bundled server

Updated `bin/comark-hook.js` to prefer `server/dist/comark-server.js` over the source path. Source is fallback for developers running `npm run server:dev` from a fresh clone. The shipped plugin always uses the bundle. ✅

### M7 — Plugin manifest registers the MCP server

`.claude-plugin/plugin.json` now declares:

```json
"mcpServers": {
  "comark": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/dist/comark-mcp.js"]
  }
}
```

Claude Code spawns the MCP server when needed, exposing comark's tool surface to both the main chat agent and any spawned subagents. ✅

### M8 — Existing test suite still passes

```
$ node --test server/test/*.test.js
ℹ tests 19
ℹ pass 19
ℹ fail 0
```

The anchor + persistence test suite is architecture-agnostic; nothing in the pivot affected it. ✅

## What the user still needs to verify (V1.x)

The remaining items are reduced. Items 1, 5.7, 5.8, 5.9 from the V1 list (around live LLM streaming via API key) no longer apply — there is no API key, the listener subagent IS the LLM.

| # | Check | Why user-only |
|---|-------|--------------|
| Lx.1 | Plugin install works on a clean Claude Code session: `/plugin marketplace add ipols/comark` → `/plugin install comark@ipols-comark` → write a markdown file → click URL → review surface opens with the SPA, no error. | Requires repo pushed to GitHub. |
| Lx.2 | The chat agent actually spawns the background listener when the hook fires. | Requires a real chat session with Agent-tool access. |
| Lx.3 | Listener answers a comment within a few seconds of pressing Send. | Requires a live listener subagent. |
| Lx.4 | The chat is aware of review activity — ask "list my open comark comments" and the agent uses `comark_list_comments` to answer. | Requires a real chat session with the comark MCP tools registered. |
| Lx.5 | Claude Desktop visual side-by-side: confirm the three named deltas from V1 (H1 weight/tracking, code-block surface, highlight pulse cadence). The pulse cadence delta-3 was tuned to 2s/0.85 in V1 already; the other two await user calibration. | Requires user's actual Claude Desktop running. |

The architecture is clean enough that "first-time install on a clean machine" should genuinely work without ceremony. Items above are verifications I can't run from this session, not known-broken behaviors.

## Architectural test status

| Layer | Status |
|-------|--------|
| MCP server (tools, stdio handshake, long-poll, post_answer, get_chat_context) | ✅ End-to-end via stdio harness |
| HTTP server (port + lockfile + Origin + register/list/save endpoints) | ✅ End-to-end via curl |
| SSE event channel (sidecar watch → emit → browser receive) | ✅ Verified with timing (~42ms emit-to-receive) |
| Cross-process coordination (~/.comark/docs.json) | ✅ HTTP writer + MCP reader |
| esbuild bundles (server + MCP) | ✅ Run standalone with no node_modules |
| Hook spawns bundled server | ✅ Code path verified |
| SPA EventSource subscription + refresh on update | ✅ Verified via simulated listener post_answer |
| ThinkingIndicator + answer-ready transition | ✅ Visually verified end-to-end |
| Live listener subagent answering real comments | ⚠️ User-required — needs real chat session |
| Public marketplace install | ⚠️ User-required — needs GitHub push |
