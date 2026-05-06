import { useEffect } from 'react';
import type { Comment } from '../types';
import { captureBlockSelection, captureCurrentSelection } from '../lib/selection';
import './ReAnchorMode.css';

type Props = {
  comment: Comment;
  /** Markdown article root — where the user clicks/selects. */
  root: HTMLElement | null;
  onAnchorAt: (
    selectors: import('../types').Selector[],
  ) => void;
  onCancel: () => void;
};

export default function ReAnchorMode({ comment, root, onAnchorAt, onCancel }: Props) {
  const quote = comment.target.selectors.find((s) => s.type === 'TextQuoteSelector');
  const exact = quote?.type === 'TextQuoteSelector' ? quote.exact : '';

  useEffect(() => {
    if (!root) return;
    document.body.classList.add('comark-reanchor-mode');

    function commit(anchorSelectors: import('../types').Selector[] | null) {
      if (!anchorSelectors) {
        flashError();
        return;
      }
      // Clear the selection so the parent surface's selection-listener doesn't
      // pop the regular new-comment composer on top of the just-completed re-anchor.
      window.getSelection()?.removeAllRanges();
      onAnchorAt(anchorSelectors);
    }

    function onMouseUp(e: MouseEvent) {
      if (!root) return;
      // Only fire for clicks/selects originating inside the root.
      if (!root.contains(e.target as Node)) return;
      // Defer so getSelection reflects final state.
      window.setTimeout(() => {
        if (!root) return;
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
          const anchor = captureCurrentSelection(root);
          commit(anchor?.selectors ?? null);
        } else {
          // No selection → treat as a click on the nearest paragraph.
          const block = (e.target as HTMLElement | null)?.closest(
            'p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, table, li',
          ) as HTMLElement | null;
          if (block) {
            const anchor = captureBlockSelection(block);
            commit(anchor?.selectors ?? null);
          } else {
            flashError();
          }
        }
      }, 0);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    }

    root.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('comark-reanchor-mode');
      root.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [root, onAnchorAt, onCancel]);

  return (
    <div className="reanchor-banner" role="dialog" aria-label="Re-anchor mode">
      <span className="reanchor-banner-label">Click or select text to re-anchor:</span>
      <span className="reanchor-banner-quote">{exact}</span>
      <button
        type="button"
        className="reanchor-banner-cancel"
        onClick={onCancel}
        aria-label="Cancel re-anchor"
      >
        Esc
      </button>
    </div>
  );
}

function flashError() {
  const banner = document.querySelector('.reanchor-banner');
  if (!banner) return;
  banner.classList.remove('reanchor-banner-error');
  // force reflow so animation re-triggers
  void (banner as HTMLElement).offsetWidth;
  banner.classList.add('reanchor-banner-error');
}
