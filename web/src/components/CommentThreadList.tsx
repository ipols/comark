import { useLayoutEffect, useMemo, useState } from 'react';
import type { Comment } from '../types';
import CommentThread from './CommentThread';
import { locateRangeForText } from '../lib/source-mapping';
import './CommentThreadList.css';

type Props = {
  docId: string;
  root: HTMLElement | null;
  /** Threads container ref — the right-side column that hosts these. */
  side: HTMLElement | null;
  comments: Comment[];
  activeCommentId: string | null;
  onActivate: (id: string) => void;
  onUpdate: (next: Comment) => void;
};

const COLLAPSED_HEIGHT_ESTIMATE = 92;
const EXPANDED_HEIGHT_ESTIMATE = 280;
const VERTICAL_GAP = 8;

type Slot = {
  comment: Comment;
  top: number;
};

export default function CommentThreadList({
  docId,
  root,
  side,
  comments,
  activeCommentId,
  onActivate,
  onUpdate,
}: Props) {
  const [slots, setSlots] = useState<Slot[]>([]);

  const visible = useMemo(
    () => comments.filter((c) => c.anchorState !== 'orphaned' && c.state !== 'dismissed'),
    [comments],
  );

  useLayoutEffect(() => {
    if (!root || !side) return;

    function recompute() {
      if (!root || !side) return;
      const sideRect = side.getBoundingClientRect();

      // For each comment, find the highlight Y in document coordinates.
      const candidates = visible.map((c) => {
        const quote = c.target.selectors.find((s) => s.type === 'TextQuoteSelector');
        if (!quote || quote.type !== 'TextQuoteSelector') {
          return { comment: c, anchorY: 0 };
        }
        const range = locateRangeForText(root, quote.exact, c.resolvedRange?.start);
        if (!range) return { comment: c, anchorY: 0 };
        const r = range.getBoundingClientRect();
        // Y in side's local coordinate system.
        return { comment: c, anchorY: r.top - sideRect.top };
      });

      // Sort by anchorY ascending and resolve overlaps with simple stacking.
      candidates.sort((a, b) => a.anchorY - b.anchorY);

      const placed: Slot[] = [];
      let cursor = 0;
      for (const cand of candidates) {
        const desired = Math.max(cand.anchorY, cursor);
        placed.push({ comment: cand.comment, top: desired });
        const isActive = activeCommentId === cand.comment.id;
        const height = isActive ? EXPANDED_HEIGHT_ESTIMATE : COLLAPSED_HEIGHT_ESTIMATE;
        cursor = desired + height + VERTICAL_GAP;
      }

      setSlots(placed);
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(root);
    ro.observe(side);
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [root, side, visible, activeCommentId]);

  if (!side || slots.length === 0) return null;

  return (
    <>
      {slots.map((s) => (
        <div
          key={s.comment.id}
          className="comment-thread-slot"
          style={{ top: s.top }}
          data-active={activeCommentId === s.comment.id ? 'true' : 'false'}
        >
          <CommentThread
            docId={docId}
            comment={s.comment}
            isActive={activeCommentId === s.comment.id}
            onActivate={() => onActivate(s.comment.id)}
            onCloseActive={() => onActivate('')}
            onUpdate={onUpdate}
          />
        </div>
      ))}
    </>
  );
}
