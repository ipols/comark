import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocPayload } from './types';
import DocSurface from './components/DocSurface';
import './App.css';

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; attempt: number }
  | { kind: 'ready'; doc: DocPayload }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

const COLD_START_BUDGET_MS = 5000;
const BACKOFF_LADDER_MS = [50, 100, 200, 400, 800, 1600, 2000];

export default function App() {
  const docId = useMemo(() => readDocIdFromUrl(), []);
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    if (!docId) {
      setState({ kind: 'empty' });
      return () => {
        cancelledRef.current = true;
      };
    }

    setState({ kind: 'loading', attempt: 0 });
    void loadWithRetry(docId, cancelledRef, setState);

    return () => {
      cancelledRef.current = true;
    };
  }, [docId]);

  if (state.kind === 'loading') {
    return <LoadingShell attempt={state.attempt} />;
  }

  if (state.kind === 'empty') {
    return <EmptyShell />;
  }

  if (state.kind === 'error') {
    return <ErrorShell message={state.message} />;
  }

  if (state.kind === 'ready') {
    return <DocSurface doc={state.doc} />;
  }

  return <LoadingShell attempt={0} />;
}

function readDocIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('doc');
}

async function loadWithRetry(
  docId: string,
  cancelledRef: { current: boolean },
  setState: (s: LoadState) => void,
) {
  const startAt = Date.now();
  let attempt = 0;

  while (!cancelledRef.current) {
    setState({ kind: 'loading', attempt });
    try {
      const res = await fetch(`/api/docs/${encodeURIComponent(docId)}`, {
        headers: { Accept: 'application/json' },
      });
      if (res.status === 200) {
        const doc = (await res.json()) as DocPayload;
        if (cancelledRef.current) return;
        setState({ kind: 'ready', doc });
        return;
      }
      if (res.status === 404) {
        if (cancelledRef.current) return;
        setState({
          kind: 'error',
          message:
            'This doc isn\'t registered with comark. Re-edit it in your Claude Code session and click the new URL.',
        });
        return;
      }
      // Other status codes: surface the error message body if any.
      const body = await res.text().catch(() => '');
      throw new Error(body || `HTTP ${res.status}`);
    } catch (err) {
      // Cold-start race: server may not be fully bound yet. Back off and retry
      // up to COLD_START_BUDGET_MS, then surface a clean error.
      const elapsed = Date.now() - startAt;
      if (elapsed >= COLD_START_BUDGET_MS) {
        if (cancelledRef.current) return;
        setState({
          kind: 'error',
          message:
            'comark server isn\'t responding. Make sure the local server is running, then refresh.',
        });
        return;
      }
      const delay = BACKOFF_LADDER_MS[Math.min(attempt, BACKOFF_LADDER_MS.length - 1)];
      attempt += 1;
      await sleep(delay);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function LoadingShell({ attempt }: { attempt: number }) {
  // Hide the loading state for the first ~120ms so a fast load shows no flicker.
  const [visible, setVisible] = useState(attempt > 0);
  useEffect(() => {
    if (attempt > 0) {
      setVisible(true);
      return;
    }
    const t = window.setTimeout(() => setVisible(true), 120);
    return () => window.clearTimeout(t);
  }, [attempt]);

  return (
    <div className="shell shell-loading" data-visible={visible ? 'true' : 'false'}>
      <div className="shell-card">
        <div className="shell-shimmer-line shimmer-w-2xl" />
        <div className="shell-shimmer-line shimmer-w-md" />
        <div className="shell-shimmer-line shimmer-w-lg" />
        <div className="shell-shimmer-line shimmer-w-md" />
        <div className="shell-shimmer-line shimmer-w-xl" />
      </div>
      {attempt > 1 && (
        <p className="shell-hint">
          comark is starting up — this should clear in a moment.
        </p>
      )}
    </div>
  );
}

function EmptyShell() {
  return (
    <div className="shell">
      <div className="shell-card shell-card-message">
        <h1 className="shell-title">comark</h1>
        <p className="shell-body">
          The review surface opens automatically when an agent in your Claude
          Code session writes a substantive markdown file.
        </p>
        <p className="shell-body shell-body-muted">
          Open a markdown file via Claude Code to start a review.
        </p>
      </div>
    </div>
  );
}

function ErrorShell({ message }: { message: string }) {
  return (
    <div className="shell">
      <div className="shell-card shell-card-message">
        <h1 className="shell-title">Couldn&rsquo;t load the doc</h1>
        <p className="shell-body">{message}</p>
        <button
          type="button"
          className="shell-button"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
