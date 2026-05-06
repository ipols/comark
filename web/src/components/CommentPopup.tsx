import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './CommentPopup.css';

type Props = {
  anchorRect: DOMRect;
  onSubmit: (text: string) => void;
  onCancel: () => void;
};

const POPUP_WIDTH = 360;
const VIEWPORT_PAD = 12;
const VERTICAL_GAP = 10;

export default function CommentPopup({ anchorRect, onSubmit, onCancel }: Props) {
  const [text, setText] = useState('');
  const [position, setPosition] = useState<{ top: number; left: number; placement: 'above' | 'below' } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => textareaRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, []);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const cardHeight = card.offsetHeight;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Default: above the selection.
    const placeAbove = anchorRect.top - cardHeight - VERTICAL_GAP > VIEWPORT_PAD;
    const top = placeAbove
      ? anchorRect.top + window.scrollY - cardHeight - VERTICAL_GAP
      : anchorRect.bottom + window.scrollY + VERTICAL_GAP;

    // Horizontally center on selection, then clamp.
    let left = anchorRect.left + window.scrollX + anchorRect.width / 2 - POPUP_WIDTH / 2;
    if (left < window.scrollX + VIEWPORT_PAD) left = window.scrollX + VIEWPORT_PAD;
    if (left + POPUP_WIDTH > window.scrollX + vw - VIEWPORT_PAD) {
      left = window.scrollX + vw - VIEWPORT_PAD - POPUP_WIDTH;
    }

    // Sanity check vertical bounds.
    const clampedTop = Math.max(window.scrollY + VIEWPORT_PAD, Math.min(top, window.scrollY + vh - VIEWPORT_PAD - cardHeight));

    setPosition({ top: clampedTop, left, placement: placeAbove ? 'above' : 'below' });
  }, [anchorRect]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (text.trim()) onSubmit(text);
      }
    }
    function onClickOutside(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onCancel();
      }
    }
    window.addEventListener('keydown', onKey);
    // Slight delay so the click that opened the popup doesn't immediately close it.
    const t = window.setTimeout(() => {
      window.addEventListener('mousedown', onClickOutside);
    }, 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClickOutside);
      window.clearTimeout(t);
    };
  }, [onCancel, onSubmit, text]);

  function handleSubmit() {
    if (text.trim()) onSubmit(text);
  }

  return (
    <div
      ref={cardRef}
      className="comment-popup"
      data-placement={position?.placement ?? 'above'}
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        width: POPUP_WIDTH,
        opacity: position ? 1 : 0,
      }}
      role="dialog"
      aria-label="Add comment"
    >
      <textarea
        ref={textareaRef}
        className="comment-popup-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Leave a comment…"
        rows={3}
      />
      <div className="comment-popup-footer">
        <span className="comment-popup-hint">⌘ Return to send · Esc to cancel</span>
        <button
          type="button"
          className="comment-popup-submit"
          onClick={handleSubmit}
          disabled={!text.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
