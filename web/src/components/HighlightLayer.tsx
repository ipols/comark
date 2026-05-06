import { useLayoutEffect, useState } from 'react';
import type { Comment } from '../types';
import { locateRangeForText } from '../lib/source-mapping';
import './HighlightLayer.css';

type Props = {
  /** The DocSurface markdown root these highlights overlay. */
  root: HTMLElement | null;
  /** Anchored / approximate comments only — orphaned ones are surfaced in the tray. */
  comments: Comment[];
  activeCommentId?: string | null;
  onSelect?: (commentId: string) => void;
};

type HighlightRect = {
  commentId: string;
  uiState: NonNullable<Comment['uiState']>;
  anchorState: Comment['anchorState'];
  rects: DOMRect[];
};

export default function HighlightLayer({ root, comments, activeCommentId, onSelect }: Props) {
  const [layout, setLayout] = useState<HighlightRect[]>([]);

  useLayoutEffect(() => {
    if (!root) {
      setLayout([]);
      return;
    }

    function computeRects() {
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const next: HighlightRect[] = [];
      for (const comment of comments) {
        if (comment.anchorState === 'orphaned') continue;
        const quote = comment.target.selectors.find((s) => s.type === 'TextQuoteSelector');
        if (!quote || quote.type !== 'TextQuoteSelector') continue;
        const range = locateRangeForText(
          root,
          quote.exact,
          comment.resolvedRange?.start,
        );
        if (!range) continue;

        const clientRects = Array.from(range.getClientRects());
        if (clientRects.length === 0) continue;

        const adjusted = clientRects.map(
          (r) =>
            new DOMRect(
              r.left - rootRect.left + root.scrollLeft,
              r.top - rootRect.top + root.scrollTop,
              r.width,
              r.height,
            ),
        );

        next.push({
          commentId: comment.id,
          uiState: comment.uiState ?? (comment.state === 'resolved' ? 'resolved' : 'idle'),
          anchorState: comment.anchorState,
          rects: adjusted,
        });
      }
      setLayout(next);
    }

    computeRects();

    const ro = new ResizeObserver(() => computeRects());
    ro.observe(root);
    window.addEventListener('resize', computeRects);
    window.addEventListener('scroll', computeRects, true);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', computeRects);
      window.removeEventListener('scroll', computeRects, true);
    };
  }, [root, comments]);

  if (!root || layout.length === 0) return null;

  return (
    <>
      {layout.map((h) => (
        <div
          key={h.commentId}
          className="highlight-group"
          data-state={h.uiState}
          data-anchor={h.anchorState}
          data-active={activeCommentId === h.commentId ? 'true' : 'false'}
        >
          {h.rects.map((r, i) => (
            <span
              key={i}
              role="button"
              tabIndex={0}
              className="highlight-rect"
              style={{
                top: r.top,
                left: r.left,
                width: r.width,
                height: r.height,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.(h.commentId);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect?.(h.commentId);
                }
              }}
            />
          ))}
        </div>
      ))}
    </>
  );
}
