// Tiny API client for the comark local server.
// All POSTs include the same-origin Origin header (the browser sets it
// automatically on cross-origin fetches; on same-origin fetches it's
// absent — the server's allow-list accepts that case for GETs only and
// requires it for POSTs, so we set it explicitly to keep semantics clear).

import type { Comment, DocPayload, Selector } from '../types';

export type LlmStreamEvent =
  | { type: 'chunk'; text: string }
  | { type: 'complete'; text: string; model?: string }
  | { type: 'error'; message: string };

export type LlmStreamRequest = {
  commentId: string;
  comment: string;
  selection?: Selector | null;
  model?: string | null;
};

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

/** Stream an LLM answer for a comment.
 *  Returns a function that aborts the stream when called.
 *  `onEvent` is invoked with each parsed SSE event in order. */
export function streamLlmAnswer(
  docId: string,
  payload: LlmStreamRequest,
  onEvent: (e: LlmStreamEvent) => void,
): () => void {
  const controller = new AbortController();

  void (async () => {
    try {
      const res = await fetch('/api/llm/answer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ docId, ...payload }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => '');
        onEvent({ type: 'error', message: body || `HTTP ${res.status}` });
        return;
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;

        let nlIdx;
        // Each SSE message ends with \n\n.
        while ((nlIdx = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, nlIdx);
          buffer = buffer.slice(nlIdx + 2);
          const parsed = parseSseMessage(raw);
          if (parsed) onEvent(parsed);
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      onEvent({ type: 'error', message: (err as Error).message || 'Stream failed' });
    }
  })();

  return () => controller.abort();
}

function parseSseMessage(raw: string): LlmStreamEvent | null {
  let event = '';
  let data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue; // comment
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data = (data ? data + '\n' : '') + line.slice(5).trim();
  }
  if (!event || !data) return null;
  try {
    const parsed = JSON.parse(data);
    if (event === 'chunk' && typeof parsed.text === 'string') {
      return { type: 'chunk', text: parsed.text };
    }
    if (event === 'complete') {
      return { type: 'complete', text: parsed.text || '', model: parsed.model };
    }
    if (event === 'error') {
      return { type: 'error', message: parsed.message || 'unknown' };
    }
  } catch {
    // ignore malformed
  }
  return null;
}
