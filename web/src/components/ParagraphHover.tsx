import { useEffect, useState } from 'react';
import './ParagraphHover.css';

type Props = {
  /** Root element containing the rendered markdown. Hover affordances attach
   *  to top-level block children of this root. */
  root: HTMLElement | null;
  onPick: (block: HTMLElement) => void;
};

const HOVER_BLOCK_SELECTOR =
  '.markdown-body > p, .markdown-body > h1, .markdown-body > h2, .markdown-body > h3, .markdown-body > h4, .markdown-body > h5, .markdown-body > h6, .markdown-body > ul, .markdown-body > ol, .markdown-body > blockquote, .markdown-body > pre, .markdown-body > table';

type HoverState = {
  block: HTMLElement;
  rect: DOMRect;
};

export default function ParagraphHover({ root, onPick }: Props) {
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => {
    if (!root) return;
    const body = root.querySelector('.markdown-body') as HTMLElement | null;
    if (!body) return;

    function onMouseMove(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const block = target.closest(HOVER_BLOCK_SELECTOR) as HTMLElement | null;
      if (block && body!.contains(block)) {
        setHover({ block, rect: block.getBoundingClientRect() });
      } else {
        setHover(null);
      }
    }

    function onMouseLeave() {
      setHover(null);
    }

    function onScroll() {
      setHover((s) => (s ? { ...s, rect: s.block.getBoundingClientRect() } : null));
    }

    body.addEventListener('mousemove', onMouseMove);
    body.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      body.removeEventListener('mousemove', onMouseMove);
      body.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [root]);

  if (!hover) return null;

  const top = hover.rect.top + window.scrollY + 4;
  const left = hover.rect.right + window.scrollX + 6;

  return (
    <button
      type="button"
      className="paragraph-hover-btn"
      style={{ top, left }}
      onMouseDown={(e) => {
        // Prevent the mousedown from collapsing the user's selection if any.
        e.preventDefault();
      }}
      onClick={() => {
        onPick(hover.block);
        setHover(null);
      }}
      aria-label="Comment on paragraph"
      title="Comment on paragraph"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M2 3.5C2 2.67 2.67 2 3.5 2h7c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5H6L3.5 12V10c-.83 0-1.5-.67-1.5-1.5v-5z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
