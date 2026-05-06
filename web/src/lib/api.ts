// Tiny API client for the comark local server.
// All POSTs include the same-origin Origin header (the browser sets it
// automatically on cross-origin fetches; on same-origin fetches it's
// absent — the server's allow-list accepts that case for GETs only and
// requires it for POSTs, so we set it explicitly to keep semantics clear).

import type { Comment, DocPayload } from '../types';

export async function fetchDoc(docId: string): Promise<DocPayload> {
  const res = await fetch(`/api/docs/${encodeURIComponent(docId)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `HTTP ${res.status}`);
  }
  return (await res.json()) as DocPayload;
}

export async function saveComment(
  docId: string,
  comment: Partial<Comment>,
): Promise<Comment> {
  const res = await fetch(`/api/comments/${encodeURIComponent(docId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ comment }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `HTTP ${res.status}`);
  }
  const json = (await res.json()) as { comment: Comment };
  return json.comment;
}
