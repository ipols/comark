// API: comment CRUD.
// GET  /api/comments/:docId  — fetch comments for incremental refresh.
// POST /api/comments/:docId  — create or update a single comment.
//
// Wire-format for POST body:
//   {
//     "comment": { id?, target, thread, state, anchorState, ... }
//   }
// If `id` is absent, the server assigns a UUID. Returns the persisted entity
// with `lastResolvedAt` and `lastResolvedScore` populated.

import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { sendJson, readJsonBody } from '../lib/router.js';
import { getDoc } from '../lib/doc-registry.js';
import {
  loadComments,
  saveComments,
  resolveAllAnchors,
} from '../lib/persistence.js';

export async function handleListComments(req, res, { docId }) {
  const entry = getDoc(docId);
  if (!entry) return sendJson(res, 404, { error: 'Doc not registered' });

  let content;
  try {
    content = await readFile(entry.filePath, 'utf8');
  } catch (err) {
    return sendJson(res, 404, { error: `Could not read source file: ${err.code || err.message}` });
  }

  const stored = await loadComments(entry.filePath);
  const comments = await resolveAllAnchors(content, stored);
  return sendJson(res, 200, { comments });
}

export async function handleSaveComment(req, res, { docId }) {
  const entry = getDoc(docId);
  if (!entry) return sendJson(res, 404, { error: 'Doc not registered' });

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, err.statusCode || 400, { error: err.message });
  }

  const incoming = body?.comment;
  if (!incoming || typeof incoming !== 'object') {
    return sendJson(res, 400, { error: 'Body.comment is required' });
  }

  const stored = await loadComments(entry.filePath);
  const now = new Date().toISOString();

  let result;
  if (incoming.id) {
    const idx = stored.findIndex((c) => c.id === incoming.id);
    if (idx >= 0) {
      stored[idx] = { ...stored[idx], ...incoming, updatedAt: now };
      result = stored[idx];
    } else {
      // Client sent an id we don't have — treat as upsert.
      result = { ...incoming, createdAt: incoming.createdAt || now, updatedAt: now };
      stored.push(result);
    }
  } else {
    result = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      state: 'open',
      anchorState: 'anchored',
      thread: [],
      ...incoming,
    };
    stored.push(result);
  }

  await saveComments(entry.filePath, stored);

  // Re-resolve anchors against current content so the response carries fresh state.
  let content;
  try {
    content = await readFile(entry.filePath, 'utf8');
    const resolved = await resolveAllAnchors(content, [result]);
    result = resolved[0] ?? result;
  } catch {
    // best effort
  }

  return sendJson(res, 200, { comment: result });
}
