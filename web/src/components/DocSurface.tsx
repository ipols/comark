import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Comment, DocPayload, Selector } from '../types';
import MarkdownRenderer from './MarkdownRenderer';
import CommentPopup from './CommentPopup';
import ParagraphHover from './ParagraphHover';
import HighlightLayer from './HighlightLayer';
import CommentThreadList from './CommentThreadList';
import OrphansTray from './OrphansTray';
import ReAnchorMode from './ReAnchorMode';
import { captureBlockSelection, captureCurrentSelection, type SelectionAnchor } from '../lib/selection';
import { saveComment } from '../lib/api';
import './DocSurface.css';

type Props = {
  doc: DocPayload;
  onCommentsChanged?: (comments: Comment[]) => void;
};

export default function DocSurface({ doc, onCommentsChanged }: Props) {
  const [contextOpen, setContextOpen] = useState(false);
  const [comments, setComments] = useState<Comment[]>(doc.comments);
  const [pendingAnchor, setPendingAnchor] = useState<SelectionAnchor | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [reanchorTargetId, setReanchorTargetId] = useState<string | null>(null);
  // Callback ref → state, so child components (ParagraphHover, HighlightLayer)
  // re-render when the article element mounts. A useRef alone wouldn't trigger
  // a re-render on attach, so children would receive null forever.
  const [articleEl, setArticleEl] = useState<HTMLElement | null>(null);
  const [sideEl, setSideEl] = useState<HTMLElement | null>(null);

  const fileName = useMemo(() => extractFileName(doc.filePath), [doc.filePath]);
  const commentSummary = useMemo(() => summarizeComments(comments), [comments]);

  // Sync incoming doc.comments → local state when the parent updates them.
  useEffect(() => {
    setComments(doc.comments);
  }, [doc.comments]);

  // Selection listener — fires after the user finishes a selection.
  // Listens at the document level + uses selectionchange (debounced) so
  // right-to-left drags work the same as left-to-right. (The mouseup
  // alone can fire while the browser is still settling the selection
  // on RTL drags, leaving us with a stale or empty Selection at sample time.)
  useEffect(() => {
    if (!articleEl) return;

    let pending: number | null = null;
    let mouseDown = false;

    function maybeOpenPopup() {
      if (!articleEl) return;
      // Re-anchor mode owns selection events while it's active.
      if (document.body.classList.contains('comark-reanchor-mode')) return;
      const anchor = captureCurrentSelection(articleEl);
      if (anchor && !pendingAnchor) {
        setPendingAnchor(anchor);
      }
    }

    function schedule(delayMs: number) {
      if (pending != null) window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        pending = null;
        maybeOpenPopup();
      }, delayMs);
    }

    function onMouseDown() {
      mouseDown = true;
    }

    function onMouseUp() {
      mouseDown = false;
      // Selection is committed by the time the next macrotask runs in most
      // browsers. 30ms covers Safari/Chromium on RTL drags where the
      // selection isn't fully committed at mouseup yet.
      schedule(30);
    }

    function onSelectionChange() {
      // While the user is still dragging, don't fire the popup — that would
      // open mid-drag with a partial selection. Only fire after the drag ends.
      if (mouseDown) return;
      schedule(60);
    }

    articleEl.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      articleEl.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('selectionchange', onSelectionChange);
      if (pending != null) window.clearTimeout(pending);
    };
  }, [articleEl, pendingAnchor]);

  const handlePopupSubmit = useCallback(
    async (text: string) => {
      if (!pendingAnchor) return;
      const optimistic: Comment = {
        id: `tmp-${Math.random().toString(36).slice(2, 10)}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        state: 'open',
        uiState: 'pending',
        anchorState: 'anchored',
        thread: [{ role: 'user', text, kind: 'selection-anchored' }],
        target: { selectors: pendingAnchor.selectors },
      };
      setComments((prev) => {
        const next = [...prev, optimistic];
        onCommentsChanged?.(next);
        return next;
      });
      setPendingAnchor(null);
      try {
        const persisted = await saveComment(doc.docId, {
          target: { selectors: pendingAnchor.selectors },
          thread: [{ role: 'user', text, kind: 'selection-anchored' }],
          state: 'open',
          uiState: 'pending',
        });
        setComments((prev) => {
          const next = prev.map((c) => (c.id === optimistic.id ? persisted : c));
          onCommentsChanged?.(next);
          return next;
        });
        setActiveCommentId(persisted.id);
      } catch (err) {
        // Mark the optimistic comment as error.
        setComments((prev) =>
          prev.map((c) =>
            c.id === optimistic.id
              ? {
                  ...c,
                  uiState: 'error',
                  lastError: (err as Error).message || 'Save failed',
                }
              : c,
          ),
        );
      }
    },
    [pendingAnchor, doc.docId, onCommentsChanged],
  );

  const handlePopupCancel = useCallback(() => {
    setPendingAnchor(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const handleParagraphPick = useCallback((block: HTMLElement) => {
    if (!articleEl) return;
    const anchor = captureBlockSelection(block);
    if (anchor) setPendingAnchor(anchor);
  }, [articleEl]);

  return (
    <div className="doc-surface">
      <header className="doc-header">
        <div className="doc-header-inner">
          <div className="doc-header-title">
            <span className="doc-header-eyebrow">comark review</span>
            <h1 className="doc-header-name">{fileName}</h1>
          </div>
          <div className="doc-header-meta">
            {doc.model && (
              <span className="doc-meta-chip" title="Model used for inline answers">
                <span className="doc-meta-chip-dot" />
                {doc.model}
              </span>
            )}
            {commentSummary && (
              <span className="doc-meta-chip doc-meta-chip-comments">
                {commentSummary}
              </span>
            )}
            {doc.contextSummary && (
              <button
                type="button"
                className="doc-meta-button"
                onClick={() => setContextOpen((s) => !s)}
                aria-expanded={contextOpen}
              >
                Context
                <svg
                  className={`doc-meta-chevron${contextOpen ? ' is-open' : ''}`}
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                >
                  <path
                    d="M3 4.5L6 7.5L9 4.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
        {contextOpen && doc.contextSummary && (
          <div className="doc-context-panel">
            <MarkdownRenderer source={doc.contextSummary} />
          </div>
        )}
      </header>
      <main className="doc-main">
        <article className="doc-article" ref={setArticleEl}>
          <MarkdownRenderer source={doc.content} />
          <HighlightLayer
            root={articleEl}
            comments={comments}
            activeCommentId={activeCommentId}
            onSelect={setActiveCommentId}
          />
        </article>
        <aside className="doc-side" aria-label="Comment threads" ref={setSideEl}>
          <CommentThreadList
            docId={doc.docId}
            root={articleEl}
            side={sideEl}
            comments={comments}
            activeCommentId={activeCommentId}
            onActivate={(id) => setActiveCommentId(id || null)}
            onUpdate={(next) => {
              setComments((prev) => {
                const out = prev.map((c) => (c.id === next.id ? next : c));
                onCommentsChanged?.(out);
                return out;
              });
            }}
          />
        </aside>
      </main>
      <ParagraphHover root={articleEl} onPick={handleParagraphPick} />
      {pendingAnchor && (
        <CommentPopup
          anchorRect={pendingAnchor.rangeRect}
          onSubmit={handlePopupSubmit}
          onCancel={handlePopupCancel}
        />
      )}
      <OrphansTray
        comments={comments}
        onReanchor={(id) => setReanchorTargetId(id)}
        onDismiss={async (id) => {
          const target = comments.find((c) => c.id === id);
          if (!target) return;
          const next = await saveComment(doc.docId, {
            ...target,
            state: 'dismissed',
            uiState: 'dismissed',
          });
          setComments((prev) => {
            const out = prev.map((c) => (c.id === next.id ? next : c));
            onCommentsChanged?.(out);
            return out;
          });
        }}
      />
      {reanchorTargetId && (
        <ReAnchorMode
          comment={
            comments.find((c) => c.id === reanchorTargetId) ?? comments[0]
          }
          root={articleEl}
          onCancel={() => setReanchorTargetId(null)}
          onAnchorAt={async (selectors) => {
            const target = comments.find((c) => c.id === reanchorTargetId);
            if (!target) {
              setReanchorTargetId(null);
              return;
            }
            const next = await saveComment(doc.docId, {
              ...target,
              target: { ...target.target, selectors },
              anchorState: 'anchored',
            });
            setComments((prev) => {
              const out = prev.map((c) => (c.id === next.id ? next : c));
              onCommentsChanged?.(out);
              return out;
            });
            setReanchorTargetId(null);
          }}
        />
      )}
    </div>
  );
}

function extractFileName(p: string): string {
  if (!p) return 'untitled.md';
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

function summarizeComments(comments: Comment[]): string | null {
  if (!comments || comments.length === 0) return null;
  const open = comments.filter(
    (c) => c.state === 'open' && c.anchorState !== 'orphaned',
  ).length;
  const orphaned = comments.filter((c) => c.anchorState === 'orphaned').length;
  const resolved = comments.filter((c) => c.state === 'resolved').length;

  const parts: string[] = [];
  if (open > 0) parts.push(`${open} open`);
  if (orphaned > 0) parts.push(`${orphaned} orphan${orphaned === 1 ? '' : 's'}`);
  if (resolved > 0) parts.push(`${resolved} resolved`);
  return parts.length > 0 ? parts.join(' · ') : `${comments.length} comments`;
}

// Selector type only re-exported here so other components can build target.selectors. Not wired anywhere yet.
export type { Selector };
