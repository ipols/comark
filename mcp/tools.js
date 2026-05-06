// MCP tool implementations. Each tool is a pure async function that
// returns a JSON-serializable result. The MCP server (mcp/index.js)
// wires these into the @modelcontextprotocol/sdk McpServer.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  loadComments,
  saveComments,
  sidecarPathFor,
} from '../server/lib/persistence.js';
import { readSharedRegistry } from '../server/lib/shared-registry.js';
import { buildContextSummary } from '../bin/comark-context.js';

const POLL_INTERVAL_MS = 500;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 5 * 60_000;

/**
 * Long-poll for the next pending comment across all active docs in the shared registry.
 * Returns null on timeout, comment bundle on success.
 *
 * "Pending" = state==='open' AND uiState==='pending' AND last thread turn is a user turn
 * (no assistant answer yet).
 */
export async function waitForPendingComment(args = {}) {
  const timeoutMs = clampTimeout(args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const filterDocPath = typeof args.docPath === 'string' ? args.docPath : null;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const candidate = await scanForPending(filterDocPath);
    if (candidate) return { status: 'comment', ...candidate };
    await sleep(POLL_INTERVAL_MS);
  }
  return { status: 'timeout' };
}

async function scanForPending(filterDocPath) {
  const reg = await readSharedRegistry();
  for (const docEntry of reg.docs) {
    if (filterDocPath && docEntry.filePath !== filterDocPath) continue;
    const sidecarPath = sidecarPathFor(docEntry.filePath);
    if (!existsSync(sidecarPath)) continue;
    const comments = await loadComments(docEntry.filePath);
    const pending = comments.find(isPendingForAnswer);
    if (pending) {
      let docContent = '';
      try {
        docContent = await readFile(docEntry.filePath, 'utf8');
      } catch {
        continue;
      }
      const lastUser = [...pending.thread].reverse().find((t) => t.role === 'user');
      const quote = pending.target?.selectors?.find((s) => s?.type === 'TextQuoteSelector');
      return {
        commentId: pending.id,
        docId: docEntry.docId,
        docPath: docEntry.filePath,
        docContent,
        selectionText: quote?.exact ?? null,
        commentText: lastUser?.text ?? null,
        thread: pending.thread,
        chatModel: docEntry.model ?? null,
        contextSummary: docEntry.contextSummary ?? null,
        priorAssistantTurnPartialText: lastIncompleteAssistantText(pending.thread),
      };
    }
  }
  return null;
}

function isPendingForAnswer(comment) {
  if (comment.state !== 'open') return false;
  if (comment.uiState !== 'pending') return false;
  if (!Array.isArray(comment.thread) || comment.thread.length === 0) return false;
  const last = comment.thread[comment.thread.length - 1];
  // User just submitted a question OR the previous assistant attempt was incomplete.
  if (last.role === 'user') return true;
  if (last.role === 'assistant' && last.state !== 'complete') return true;
  return false;
}

function lastIncompleteAssistantText(thread) {
  const last = thread[thread.length - 1];
  if (last?.role === 'assistant' && last.state !== 'complete') return last.text || '';
  return null;
}

/**
 * Post the answer for a comment. Atomically updates the sidecar:
 *   - Adds (or replaces incomplete) assistant turn with state='complete'.
 *   - Sets uiState='answer-ready'.
 * The HTTP server's filesystem watch picks up the sidecar mtime change and
 * pushes an SSE event to the browser, so the answer renders within ~100ms
 * of the write returning.
 */
export async function postAnswer(args) {
  const commentId = String(args.commentId || '').trim();
  const text = String(args.text || '');
  if (!commentId) throw new Error('commentId required');
  if (!text.trim()) throw new Error('text required (non-empty)');

  const reg = await readSharedRegistry();
  for (const docEntry of reg.docs) {
    const comments = await loadComments(docEntry.filePath);
    const idx = comments.findIndex((c) => c.id === commentId);
    if (idx < 0) continue;

    const comment = comments[idx];
    const last = comment.thread[comment.thread.length - 1];
    const newAssistantTurn = { role: 'assistant', text, state: 'complete' };
    if (last?.role === 'assistant' && last.state !== 'complete') {
      comment.thread = [...comment.thread.slice(0, -1), newAssistantTurn];
    } else {
      comment.thread = [...comment.thread, newAssistantTurn];
    }
    comment.uiState = 'answer-ready';
    comment.updatedAt = new Date().toISOString();
    delete comment.lastError;

    comments[idx] = comment;
    await saveComments(docEntry.filePath, comments);
    return { status: 'ok', docPath: docEntry.filePath, commentId };
  }
  throw new Error(`comment ${commentId} not found in any registered doc`);
}

/**
 * Get the chat-session context for the most-recently-registered doc (or the
 * doc the caller specifies). Returns a parsed transcript summary + current model.
 *
 * Use this in the listener subagent's loop to inherit live awareness of what
 * the main chat agent has been discussing — fresh on every comment.
 */
export async function getChatContext(args = {}) {
  const reg = await readSharedRegistry();
  if (reg.docs.length === 0) return { status: 'no-docs' };

  let target = null;
  if (args.docPath) {
    target = reg.docs.find((d) => d.filePath === args.docPath) ?? null;
  } else {
    // Most recently registered.
    target = [...reg.docs].sort((a, b) => (a.registeredAt < b.registeredAt ? 1 : -1))[0];
  }
  if (!target) return { status: 'no-match' };

  if (!target.transcriptPath) {
    return {
      status: 'ok',
      docId: target.docId,
      docPath: target.filePath,
      summary: target.contextSummary ?? null,
      model: target.model ?? null,
      transcriptAvailable: false,
    };
  }

  const fresh = await buildContextSummary(target.transcriptPath);
  return {
    status: 'ok',
    docId: target.docId,
    docPath: target.filePath,
    summary: fresh.summary ?? target.contextSummary ?? null,
    model: fresh.model ?? target.model ?? null,
    transcriptAvailable: true,
  };
}

/** List all comments for a doc (or all active docs). */
export async function listComments(args = {}) {
  const reg = await readSharedRegistry();
  const filter = args.docPath ? reg.docs.filter((d) => d.filePath === args.docPath) : reg.docs;
  const out = [];
  for (const d of filter) {
    const comments = await loadComments(d.filePath);
    out.push({
      docId: d.docId,
      docPath: d.filePath,
      comments: comments.map(summarizeComment),
    });
  }
  return { docs: out };
}

/** Comments updated since `since` (ISO timestamp). Useful for the chat agent
 *  to surface recent review activity ("what's changed in the last hour?"). */
export async function recentActivity(args = {}) {
  const reg = await readSharedRegistry();
  const since = args.since ? new Date(args.since).toISOString() : null;
  const filter = args.docPath ? reg.docs.filter((d) => d.filePath === args.docPath) : reg.docs;
  const out = [];
  for (const d of filter) {
    const comments = await loadComments(d.filePath);
    const filtered = since ? comments.filter((c) => (c.updatedAt || '') > since) : comments;
    out.push({
      docId: d.docId,
      docPath: d.filePath,
      comments: filtered
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .map(summarizeComment),
    });
  }
  return { docs: out };
}

/** What docs has comark seen this session? */
export async function listActiveDocs() {
  const reg = await readSharedRegistry();
  return {
    docs: reg.docs.map((d) => ({
      docId: d.docId,
      docPath: d.filePath,
      registeredAt: d.registeredAt,
      model: d.model ?? null,
    })),
  };
}

function summarizeComment(c) {
  const quote = c.target?.selectors?.find((s) => s?.type === 'TextQuoteSelector');
  return {
    id: c.id,
    state: c.state,
    uiState: c.uiState,
    anchorState: c.anchorState,
    quote: quote?.exact ?? null,
    threadTurns: c.thread.length,
    lastTurn: c.thread[c.thread.length - 1] ?? null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function clampTimeout(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_TIMEOUT_MS;
  if (ms > MAX_TIMEOUT_MS) return MAX_TIMEOUT_MS;
  return ms;
}
