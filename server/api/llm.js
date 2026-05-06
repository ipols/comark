// API: SSE streaming answer endpoint.
// POST /api/llm/answer — Origin-validated, returns an SSE stream.
//
// Wire format (request):
//   { commentId, docId, selection, comment, model? }
// The server pulls contextSummary and (fallback) model from the in-memory
// doc registry — never trusting what the client sends for those fields.
//
// Wire format (response, SSE):
//   event: chunk      data: {"text": "..."}
//   event: complete   data: {"text": "<full text>"}
//   event: error      data: {"message": "..."}

import { readFile } from 'node:fs/promises';
import { readJsonBody, sendJson } from '../lib/router.js';
import { getDoc } from '../lib/doc-registry.js';
import {
  loadComments,
  saveComments,
} from '../lib/persistence.js';
import { streamAnswer } from '../lib/llm-client.js';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// HTML-comment stripping mitigates prompt-injection from agent-written
// markdown that may smuggle `<!-- SYSTEM: ... -->` instructions.
export function stripHtmlComments(content) {
  return content.replace(/<!--[\s\S]*?-->/g, '');
}

export async function handleLlmAnswer(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, err.statusCode || 400, { error: err.message });
  }

  const { commentId, docId, selection, comment } = body || {};
  if (!docId || typeof docId !== 'string') {
    return sendJson(res, 400, { error: 'docId is required' });
  }
  if (!commentId || typeof commentId !== 'string') {
    return sendJson(res, 400, { error: 'commentId is required' });
  }
  if (typeof comment !== 'string' || !comment.trim()) {
    return sendJson(res, 400, { error: 'comment is required' });
  }

  const entry = getDoc(docId);
  if (!entry) return sendJson(res, 404, { error: 'Doc not registered' });

  let docContent;
  try {
    docContent = await readFile(entry.filePath, 'utf8');
  } catch (err) {
    return sendJson(res, 404, { error: `Could not read source file: ${err.code || err.message}` });
  }

  // Strip HTML comments before sending to LLM (prompt-injection mitigation).
  const sanitizedDoc = stripHtmlComments(docContent);

  // Resolve effective model: registry wins; else COMARK_MODEL; else documented default.
  const model =
    entry.model ||
    process.env.COMARK_MODEL ||
    'claude-sonnet-4-6';

  // Open SSE response.
  res.writeHead(200, SSE_HEADERS);
  // Helps proxies + some browsers start rendering.
  res.write(': comark stream open\n\n');

  // Find the comment so we can persist incremental assistant turns.
  const allComments = await loadComments(entry.filePath);
  const comm = allComments.find((c) => c.id === commentId);

  let accumulated = '';
  let chunkCount = 0;
  let lastWriteAt = 0;
  const PARAGRAPH_BOUNDARY = /\n\n/;

  async function persistPartial({ stateOverride } = {}) {
    if (!comm) return;
    // Find or create the assistant turn (last turn if it's assistant-incomplete).
    const last = comm.thread[comm.thread.length - 1];
    if (last?.role === 'assistant' && last.state !== 'complete') {
      last.text = accumulated;
      last.state = stateOverride || 'incomplete';
    } else {
      comm.thread.push({
        role: 'assistant',
        text: accumulated,
        state: stateOverride || 'incomplete',
      });
    }
    comm.updatedAt = new Date().toISOString();
    await saveComments(entry.filePath, allComments);
  }

  // Append the user's prompting text as the user turn so the conversation history is intact.
  if (comm) {
    comm.thread.push({
      role: 'user',
      text: comment,
      kind: selection ? 'selection-anchored' : 'follow-up',
    });
    comm.state = 'open';
    comm.uiState = 'pending';
    await saveComments(entry.filePath, allComments);
  }

  try {
    for await (const chunk of streamAnswer({
      model,
      doc: sanitizedDoc,
      selection,
      comment,
      contextSummary: entry.contextSummary,
      thread: comm?.thread || [],
    })) {
      accumulated += chunk;
      chunkCount += 1;
      writeSse(res, 'chunk', { text: chunk });

      // Persistence cadence: every \n\n boundary or every 10 chunks.
      const since = chunkCount - lastWriteAt;
      if (PARAGRAPH_BOUNDARY.test(chunk) || since >= 10) {
        await persistPartial();
        lastWriteAt = chunkCount;
      }
    }

    // Final write: mark complete.
    if (comm) {
      const last = comm.thread[comm.thread.length - 1];
      if (last?.role === 'assistant') {
        last.text = accumulated;
        last.state = 'complete';
      } else {
        comm.thread.push({ role: 'assistant', text: accumulated, state: 'complete' });
      }
      comm.uiState = 'answer-ready';
      comm.updatedAt = new Date().toISOString();
      await saveComments(entry.filePath, allComments);
    }
    writeSse(res, 'complete', { text: accumulated, model });
    res.end();
  } catch (err) {
    // Sanitize: never forward raw SDK exception text — it can contain Authorization headers.
    const safeMessage =
      typeof err?.publicMessage === 'string'
        ? err.publicMessage
        : 'The LLM request failed. Check your ANTHROPIC_API_KEY and try again.';
    if (comm) {
      comm.uiState = 'error';
      comm.lastError = safeMessage;
      comm.updatedAt = new Date().toISOString();
      await saveComments(entry.filePath, allComments).catch(() => {});
    }
    writeSse(res, 'error', { message: safeMessage });
    res.end();
  }
}
