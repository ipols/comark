---
date: 2026-05-06
topic: comark
---

# comark — Markdown Review Companion

## Summary

`comark` is an open-source Claude Code plugin that turns reviewing agent-generated markdown into an in-place comment-and-answer flow: when the agent finishes writing a substantive `.md` file, a review surface opens in the user's browser, supports text-selection and per-paragraph commenting, answers each comment inline using an LLM with the originating conversation's context, and persists comment state across sessions.

---

## Problem Frame

The user works with agentic coding tools (primarily Claude Code in the Claude Desktop App's Code mode) that produce substantial markdown documents multiple times a day — PRDs, brainstorms, plans, learnings docs. Reviewing these documents today requires copy-pasting paragraph snippets into chat with prose comments, scrolling back to verify what the agent updated, and holding feedback in the user's head while reading the rest of the doc. Long docs amplify the friction: review becomes a serial back-and-forth instead of a batch-and-resolve flow, and feedback gets dropped because there is nowhere to park a thought mid-read.

The 30-minutes-ago concrete instance: a PRD-style doc on the iKoCoach project, several pages long, where the user wanted to leave a handful of focused comments while reading and have them answered without losing place in the document. None of today's surfaces — the chat panel, the markdown preview in Code mode, the file editor — support that workflow. The cost is daily friction and incomplete review feedback.

---

## Actors

- A1. **User**: A developer reviewing markdown documents the agent has written. Single user, single machine. Wants to give focused, in-place feedback without leaving the doc.
- A2. **Originating agent**: The Claude Code session that wrote the markdown file. Drops a context summary at trigger time. May later read accepted comment outcomes.
- A3. **Review-LLM**: The LLM the review surface calls to answer comments. Operates from the local server with the doc, the selected text, the comment, and the context summary the originating agent left. Distinct from the originating agent because it does not run inside that session.

---

## Key Flows

- F1. **Trigger and open the review surface**
  - **Trigger:** The originating agent writes or edits a markdown file above the configured length threshold.
  - **Actors:** A2, A1
  - **Steps:** 1) Agent writes the file. 2) The plugin's hook fires after the write. 3) The hook spawns or reuses the local server and passes the file path. 4) The server prepares the doc plus the context summary the agent dropped, and exposes a review URL. 5) The user opens the URL in their browser, or sees it pinned in Code mode's preview pane.
  - **Outcome:** The rendered doc is on screen with the review affordances active.
  - **Covered by:** R1, R2, R3, R4

- F2. **Add a comment, get an inline answer**
  - **Trigger:** The user wants to leave feedback on a passage while reading.
  - **Actors:** A1, A3
  - **Steps:** 1) The user either hovers a paragraph and clicks the per-paragraph comment affordance, or selects text and releases the mouse. 2) A comment popup appears anchored to the selection. 3) The user types and submits. 4) The selection enters a visible "pending" state. 5) The local server sends the doc, the selection, the comment, and the context summary to the review-LLM. 6) The answer streams back into the comment thread inline. 7) The selection transitions to an "answer-ready" state. 8) The user reads the answer and chooses accept, refuse, or continue the conversation in-thread.
  - **Outcome:** The comment is captured, answered, and resolved or left open — without the user leaving the document surface.
  - **Covered by:** R5, R6, R7, R8, R9

- F3. **Reopen a doc after a session break**
  - **Trigger:** The user reopens a previously reviewed doc — next day, after a Mac reboot, after closing the app.
  - **Actors:** A1
  - **Steps:** 1) The agent rewrites the same `.md` file, or the user manually opens its review URL. 2) The local server loads the existing comments from persistent storage. 3) Comments and their threads render at their original locations on the rendered doc, including any orphaned comments from doc rewrites since the last session.
  - **Outcome:** Yesterday's comments are visible, including any unaddressed ones, and the user can continue review where they left off.
  - **Covered by:** R10, R11, R12

---

## Requirements

**Trigger and surfacing**

- R1. The plugin must surface the review UI automatically when the originating agent writes or edits a markdown file in the user's project, without the user needing to type a command.
- R2. The trigger must fire only on substantive markdown files. The minimum-length threshold must be configurable so trivial files do not surface the review UI.
- R3. The originating agent must supply a concise context summary at trigger time — decisions made, open questions, source files referenced — for the review-LLM to use when answering comments. The full conversation transcript is not required.
- R4. The review surface must render in a browser-compatible host. Default behavior is the user's default browser. Opportunistic behavior is rendering inside the Claude Desktop App's Code mode preview pane if that surface accepts the local URL — verified at build time, not specified upfront.

**Annotation interaction**

- R5. The user must be able to leave a comment via either per-paragraph hover-to-comment, or freeform text selection (from a few words to multiple paragraphs).
- R6. On selecting text and releasing, a comment input popup must appear immediately, in the style of Google Docs' commenting UI, with the input focused.
- R7. After submission, the highlighted text must enter a visible "pending" state and transition to a distinct "answer-ready" state when the LLM response arrives.

**Inline answer and comment thread**

- R8. The review-LLM's answer must appear inside the comment thread, anchored to the same selection — not in any external chat surface.
- R9. Each comment thread must offer the user explicit next-actions: accept, refuse, or continue the conversation. Quick-action canned prompts must be available alongside free-text follow-up.

**Persistence**

- R10. Comment state must persist across all of: closing the review surface, closing the originating agent session, closing the Claude Desktop App, rebooting the user's machine.
- R11. Persistent comment state must travel naturally with the source document so it remains valid across the user's worktree-based workflow, and must not be committed to version control by default.

**Anchor robustness on doc rewrite**

- R12. When the agent rewrites a paragraph the user has commented on, the plugin must make a best-effort attempt to keep the comment anchored to its original content. If re-anchoring fails, the comment must be flagged as orphaned in the UI but never silently lost.

**Distribution and packaging**

- R13. `comark` must be installable as a single Claude Code plugin from a public GitHub repository, with the smallest possible setup steps for a new user — ideally one install action plus an LLM API key.
- R14. The user's LLM API key must be supplied via a standard environment variable. No key-management UI in V1.

**Design quality**

- R15. The review surface must meet a Claude Desktop product aesthetic bar across typography, spacing, motion, color, and surface treatment, such that the experience feels integrated with the Claude Desktop App rather than visually bolted on. This is a non-negotiable quality gate for V1, not a stretch goal.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given a project with `comark` installed and the trigger threshold set to a non-trivial line count, when the agent finishes writing a long PRD as `docs/iKoCoach-prd.md`, the user is presented a clickable URL or the review surface auto-opens — without having issued any command.
- AE2. **Covers R5, R6.** Given the rendered review surface is open, when the user selects the phrase "weekly active users" inside a paragraph and releases the mouse, a comment popup appears anchored to that selection with the input field focused.
- AE3. **Covers R7, R8.** Given the user has submitted a comment "this section is too vague," when the LLM finishes answering, the answer appears inside the comment thread under the user's comment text, and the highlight transitions from the pending state to the answer-ready state. No message is appended to the originating chat.
- AE4. **Covers R10, R11.** Given the user left five comments on `docs/iKoCoach-prd.md` and has not addressed three of them, when the user reboots their Mac, reopens the Claude Desktop App, and reopens the same doc, all five comments — including the three unaddressed ones — are visible at their original locations with their full threads.
- AE5. **Covers R12.** Given a comment is anchored to the phrase "weekly active users" and the agent rewrites the paragraph to replace that phrase with "weekly retention cohorts," when the user reopens the review surface, the comment either re-anchors to the new content or is shown as orphaned with its original quoted text — but is not silently lost.

---

## Success Criteria

- The user, in their daily flow, gives more feedback per agent-generated doc than they did before, and stops dropping points because there is nowhere to park them mid-read.
- The user can review long docs without the back-and-forth chat cycle: open, comment-as-they-read, see inline answers, decide.
- A new user can install the plugin and begin using it in under five minutes from public GitHub.
- The review surface meets a Claude Desktop product aesthetic bar — typography, spacing, motion, and surface treatment cohesive enough that the experience feels integrated rather than bolted on. The user is explicitly picky about this; "very clean, like Claude itself" is the target.
- Every piece of the system is exercised end-to-end by the implementer (trigger fires, server starts, browser renders, selection flow works, comment popup works, LLM answer streams in, color states transition, persistence survives restart, doc-rewrite re-anchoring works) before the user is asked to validate anything. Self-verification is required, not optional.
- A downstream implementer or planning agent can read this doc and produce a working V1 without needing to invent UI behavior, persistence semantics, scope boundaries, design quality bar, or success criteria.

---

## Scope Boundaries

### Deferred for later

- Codex compatibility. The same architecture extends naturally to Codex's hook system, but V1 targets Claude Code in the Claude Desktop App only.
- Diff highlights on doc rewrite. V1 does best-effort re-anchoring; V1.1 adds visible diff overlays so the user sees what changed.
- Cross-doc and project-wide comment search.
- Drawings, freeform pen, circle annotations.
- Hosted or shareable review URLs.
- Native desktop application. Browser rendering is sufficient for V1.
- Live bridge from the comment thread back to the originating Claude Code session via Channels (Approach B). Considered and rejected for V1 due to budget, the research-preview API surface, and Codex incompatibility — but the persistence and data layer should not preclude adding it later.

### Outside this product's identity

- Real-time multi-user collaboration on the same doc. `comark` is a single-user review companion, not a collaborative editor. If team review becomes the goal, that is a different product.
- Multi-agent commenting (other agents leaving review notes alongside the user's). Same boundary as above.
- The plugin does not modify the source `.md` file directly without an explicit user approval step in the comment thread. `comark` routes feedback to the agent and surfaces answers; rewriting the doc is an explicit, user-initiated action.
- A claim of long-term durability against vendors shipping native commenting. `comark` is a personal-utility tool with a low carrying cost; if a vendor ships an equivalent feature, it is acceptable for `comark` to be retired or scoped down.

---

## Key Decisions

- **Architecture: local browser-rendered review surface, plugin-bundled (Approach A).** The only architecture that fits all locked constraints — works in the user's actual surface (Code mode does not render artifacts), achievable on the 1–2 hour build budget, packages cleanly as a single plugin, supports inline LLM answers with embedded conversation context, and supports persistence via local storage. Approach B (Channels live bridge) is over budget and Codex-incompatible. Approach C (Claude Artifact in sidebar) is physically inviable in Code mode.
- **Render host: browser by default, in-app preview-pane stretch.** The browser is universally available; Code mode's preview pane may render the local URL natively for an in-app sidebar feel. This stretch is verified at build time, not specified upfront, so V1 ships even if it does not work.
- **No durability claim.** The user's stance is explicit — happily ages out if vendors catch up; ongoing carrying cost is the only risk being managed. (Initial build budget is open-ended; the budget concern was about long-term maintenance, not first-build effort.)
- **Persistence colocated with the source document.** Comment state must travel with the user's worktree-based workflow. Project-root or global storage either does not travel with worktrees or breaks when paths move on disk.
- **BYO API key via environment variable.** No key-management UI, no hosted backend, no auth — V1 stays a single-user, single-machine tool.
- **Design bar: Claude Desktop product aesthetic.** Rationale: the felt-experience requirement is not just "polished" but "integrated." The user's stated bar is "very clean, like Claude itself" — beyond Apple-grade polish. This affects typography, spacing, motion, color, and surface choices throughout V1 and gates whether V1 ships, not just whether it works.
- **Self-verification before user testing.** Rationale: the user's explicit instruction is to prove every piece works before asking them to test. This affects build process and the definition of "V1 done": end-to-end exercising of trigger, render, comment flow, LLM answer, persistence, and restart-recovery is required before handoff.

---

## Dependencies / Assumptions

- The user's primary daily surface is Claude Code in the Claude Desktop App (Code mode), and that surface fully supports `PostToolUse` hooks, plugins, MCP servers, and shell-command execution as documented in the Claude Code reference (verified May 2026).
- The Claude Desktop App's Code mode does not render React Artifacts in a sidebar panel (verified May 2026); this fact rules out the Artifact-based architecture and makes the browser-rendered surface the right host.
- An LLM API key is available to the user, and the user is willing to supply it via environment variable.
- The user accepts that comment answers reflect the snapshot of context the originating agent leaves at trigger time, not live agent or live project state. Live-context bridging via Channels is deferred.

---

## Outstanding Questions

### Resolve Before Planning

- *(none — all scope-shaping questions resolved during brainstorm)*

### Deferred to Planning

- [Affects R4][Needs research] Can a `PostToolUse` hook programmatically open the Code mode preview pane to a localhost URL, or does the user have to pin the pane manually once and rely on it to refresh? Determines whether the in-app sidebar feel is automatic or requires a one-time setup gesture.
- [Affects R12][Technical] Anchor algorithm: text-quote selector with surrounding-context fallback is the working assumption. Planning should confirm this is sufficient for "best-effort" without committing to W3C Web Annotation Data Model rigor.
- [Affects R10, R11][Technical] Persistent storage shape: working assumption is a file colocated with the source document, gitignored by default. Planning should confirm naming, schema, and concurrency behavior for the rare case of two sessions touching the same doc.
- [Affects R3][Technical] What the originating agent embeds as the context summary — a templated structure or free prose. Affects review-LLM answer quality but not V1 scope.
- [Affects R13][Technical] Whether plugin distribution requires a marketplace listing, or whether direct GitHub install is sufficient for V1. Verify against current Claude Code plugin install paths.
