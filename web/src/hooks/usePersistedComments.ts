/*
 * usePersistedComments — polling-based data hook for the doc + comments.
 *
 * Per Key Decision (V1 doc-rewrite client refresh):
 *   - Polls /api/docs/:docId on window.focus.
 *   - Polls every 30s while the tab is focused.
 *   - Pauses polling when blurred to keep the hook quiet in the background.
 *   - SSE push-refresh is V1.1.
 *
 * Optimistic mutations land via setComments locally; the next poll round
 * reconciles against the server (server is authoritative for anchor states).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Comment, DocPayload } from '../types';
import { fetchDoc } from '../lib/api';

const POLL_INTERVAL_MS = 30000;

export type PersistedDoc = {
  doc: DocPayload | null;
  setComments: (next: Comment[] | ((prev: Comment[]) => Comment[])) => void;
  refresh: () => Promise<void>;
  loading: boolean;
  error: string | null;
};

export function usePersistedComments(initial: DocPayload | null): PersistedDoc {
  const [doc, setDoc] = useState<DocPayload | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docIdRef = useRef<string | null>(initial?.docId ?? null);

  // Keep docIdRef in sync with the latest doc.
  useEffect(() => {
    docIdRef.current = doc?.docId ?? initial?.docId ?? null;
  }, [doc, initial]);

  const refresh = useCallback(async () => {
    const docId = docIdRef.current;
    if (!docId) return;
    setLoading(true);
    try {
      const fresh = await fetchDoc(docId);
      setDoc((prev) => mergeDoc(prev, fresh));
      setError(null);
    } catch (err) {
      setError((err as Error).message || 'Refresh failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll on focus + every 30s while focused.
  useEffect(() => {
    if (!docIdRef.current) return;
    let timer: number | null = null;

    function start() {
      stop();
      timer = window.setInterval(() => {
        if (document.hasFocus()) refresh();
      }, POLL_INTERVAL_MS);
    }
    function stop() {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    }
    function onFocus() {
      void refresh();
      start();
    }
    function onBlur() {
      stop();
    }

    if (document.hasFocus()) start();
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      stop();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, [refresh]);

  const setComments: PersistedDoc['setComments'] = useCallback((updater) => {
    setDoc((prev) => {
      if (!prev) return prev;
      const next = typeof updater === 'function' ? (updater as (p: Comment[]) => Comment[])(prev.comments) : updater;
      return { ...prev, comments: next };
    });
  }, []);

  return { doc, setComments, refresh, loading, error };
}

/** Server-fresh comments override local; the local thread for an active
 *  comment may be ahead (mid-stream) so we keep local turns when they extend
 *  the server's view. Practical V1 strategy: server-wins on anchor state +
 *  metadata; client-wins on thread length + uiState during active streams. */
function mergeDoc(prev: DocPayload | null, fresh: DocPayload): DocPayload {
  if (!prev) return fresh;
  const merged = fresh.comments.map((server) => {
    const local = prev.comments.find((c) => c.id === server.id);
    if (!local) return server;
    // If local has more turns than server, keep local thread (mid-stream).
    if (local.thread.length > server.thread.length) {
      return { ...server, thread: local.thread, uiState: local.uiState };
    }
    // If local is mid-stream, keep its uiState.
    if (local.uiState === 'pending' || local.uiState === 'answering') {
      return { ...server, uiState: local.uiState };
    }
    return server;
  });

  // Carry through any local-only optimistic comments that haven't been persisted yet.
  const localOnly = prev.comments.filter((c) => !fresh.comments.some((s) => s.id === c.id));
  return { ...fresh, comments: [...merged, ...localOnly] };
}
