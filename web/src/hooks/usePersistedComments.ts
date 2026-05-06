/*
 * usePersistedComments — keeps the SPA's view of the doc + comments in sync
 * with the server, two ways:
 *
 *   1. SSE push  (/api/events?docId=…) — the server emits an `update` event
 *      whenever the sidecar mutates (from this server's own comment save, or
 *      from comark's MCP server when the listener subagent posts an answer).
 *      We refetch immediately (~100ms end-to-end).
 *
 *   2. Polling fallback — refetch on window.focus and every 30s while focused,
 *      in case the SSE connection got dropped by a sleeping browser tab or a
 *      proxy. This is belt-and-braces; the SSE channel does the heavy lifting.
 *
 * Optimistic mutations land via setComments locally; the next refresh round
 * reconciles against the server (server is authoritative for anchor states
 * and listener-posted assistant turns).
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

  // Poll on focus + every 30s while focused. (Backup to the SSE channel.)
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

  // SSE push — refetch immediately whenever the server emits an update.
  // EventSource auto-reconnects on transient network blips.
  useEffect(() => {
    const docId = docIdRef.current;
    if (!docId) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/events?docId=${encodeURIComponent(docId)}`);
    es.addEventListener('update', () => {
      void refresh();
    });
    es.onerror = () => {
      // Let the browser auto-reconnect; if it really fails, the 30s polling
      // backup will keep things in sync (just slower).
    };
    return () => {
      es.close();
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

/** Server is authoritative — the listener subagent posting an answer is the
 *  one source of truth for thread + uiState transitions. The only thing we
 *  preserve client-side is optimistic comments that haven't yet been
 *  echoed back from the server (e.g. the user just hit Send and the POST
 *  is still in flight; their optimistic comment has a temporary `tmp-…` id). */
function mergeDoc(prev: DocPayload | null, fresh: DocPayload): DocPayload {
  if (!prev) return fresh;
  // Carry through local-only optimistic comments (those whose ids the server
  // hasn't seen yet — typically `tmp-…` ids that get replaced by the server's
  // response when the POST resolves).
  const localOnly = prev.comments.filter(
    (c) => !fresh.comments.some((s) => s.id === c.id),
  );
  return { ...fresh, comments: [...fresh.comments, ...localOnly] };
}
