import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Comment, DocPayload, Selector } from '../types';
import MarkdownRenderer from './MarkdownRenderer';
import CommentPopup from './CommentPopup';
import ParagraphHover from './ParagraphHover';
import HighlightLayer from './HighlightLayer';
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
  // Callback ref → state, so child components (ParagraphHover, HighlightLayer)
  // re-render when the article element mounts. A useRef alone wouldn't trigger
  // a re-render on attach, so children would receive null forever.
  const [articleEl, setArticleEl] = useState<HTMLElement | null>(null);

  const fileName = useMemo(() => extractFileName(doc.filePath), [doc.filePath]);
  const commentSummary = useMemo(() => summarizeComments(comments), [comments]);

  // Sync incoming doc.comments → local state when the parent updates them.
  useEffect(() => {
    setComments(doc.comments);
  }, [doc.comments]);

  // Selection listener — fires when the user releases the mouse over the article.
  useEffect(() => {
    if (!articleEl) return;

    function maybeOpenPopup() {
      if (!articleEl) return;
      const anchor = captureCurrentSelection(articleEl);
      if (anchor && !pendingAnchor) {
        setPendingAnchor(anchor);
      }
    }

    function onMouseUp() {
      // Defer one frame so getSelection() reflects the final state.
      window.setTimeout(maybeOpenPopup, 0);
    }

    articleEl.addEventListener('mouseup', onMouseUp);
    return () => articleEl.removeEventListener('mouseup', onMouseUp);
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
        <aside className="doc-side" aria-label="Comment threads">
          {/* Thread overlays land here in U7/U8. Reserved column keeps the
              doc column from re-flowing once threads appear. */}
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
