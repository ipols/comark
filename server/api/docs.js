// API: doc registration and doc-content retrieval.
// POST /api/register-doc  — called by the hook script (Origin-validated).
// GET  /api/docs/:docId   — called by the SPA on load + window.focus polling.
//
// On GET, the server:
//   1. Looks up the registered file path for docId.
//   2. Re-reads the file from disk (so the SPA always sees the latest content).
//   3. Loads sidecar comments via persistence.js (U4).
//   4. Re-resolves anchors against current normalized doc (U4 anchor.js).
//   5. Returns { docId, filePath, content, contextSummary, model, comments }.

import { readFile } from 'node:fs/promises';
import { sendJson, readJsonBody } from '../lib/router.js';
import { registerDoc, getDoc } from '../lib/doc-registry.js';
import { loadComments, resolveAllAnchors } from '../lib/persistence.js';

export async function handleRegisterDoc(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, err.statusCode || 400, { error: err.message });
  }
  if (!body || typeof body !== 'object') {
    return sendJson(res, 400, { error: 'Body must be a JSON object' });
  }

  const { docId, filePath, transcriptPath, contextSummary, model } = body;
  if (typeof docId !== 'string' || !docId) {
    return sendJson(res, 400, { error: 'docId is required (string)' });
  }
  if (typeof filePath !== 'string' || !filePath) {
    return sendJson(res, 400, { error: 'filePath is required (string)' });
  }

  const entry = await registerDoc({ docId, filePath, transcriptPath, contextSummary, model });
  return sendJson(res, 200, { ok: true, doc: entry });
}

export async function handleGetDoc(req, res, { docId }) {
  const entry = getDoc(docId);
  if (!entry) {
    return sendJson(res, 404, {
      error: 'Doc not registered. The hook script must register the doc before the review surface can load it.',
    });
  }

  let content;
  try {
    content = await readFile(entry.filePath, 'utf8');
  } catch (err) {
    return sendJson(res, 404, {
      error: `Could not read source file at ${entry.filePath}: ${err.code || err.message}`,
    });
  }

  // Load + re-resolve sidecar (U4 wires this in; load returns empty if absent).
  let comments = [];
  try {
    const stored = await loadComments(entry.filePath);
    comments = await resolveAllAnchors(content, stored);
  } catch (err) {
    // Non-fatal — surface the error in the response so the SPA can warn the user.
    return sendJson(res, 200, {
      docId,
      filePath: entry.filePath,
      content,
      contextSummary: entry.contextSummary,
      model: entry.model,
      comments: [],
      persistenceWarning: err.message,
    });
  }

  return sendJson(res, 200, {
    docId,
    filePath: entry.filePath,
    content,
    contextSummary: entry.contextSummary,
    model: entry.model,
    comments,
  });
}
