import { useState } from 'react';
import type { Comment } from '../types';
import './OrphansTray.css';

type Props = {
  comments: Comment[];
  onReanchor: (commentId: string) => void;
  onDismiss: (commentId: string) => void;
};

export default function OrphansTray({ comments, onReanchor, onDismiss }: Props) {
  const [open, setOpen] = useState(false);
  const orphans = comments.filter((c) => c.anchorState === 'orphaned' && c.state !== 'dismissed');

  if (orphans.length === 0) return null;

  return (
    <div className="orphans-tray" data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        className="orphans-tray-toggle"
        onClick={() => setOpen((s) => !s)}
        aria-expanded={open}
      >
        <span className="orphans-tray-dot" />
        {orphans.length} orphan{orphans.length === 1 ? '' : 's'}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d={open ? 'M9 7.5L6 4.5L3 7.5' : 'M3 4.5L6 7.5L9 4.5'}
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="orphans-tray-panel">
          <header className="orphans-tray-header">
            <strong>Orphaned comments</strong>
            <p className="orphans-tray-blurb">
              The agent rewrote the doc and these comments could no longer be located.
              Re-anchor them to the right passage, or dismiss.
            </p>
          </header>
          <ul className="orphans-tray-list">
            {orphans.map((c) => {
              const quote = c.target.selectors.find((s) => s.type === 'TextQuoteSelector');
              const exact = quote?.type === 'TextQuoteSelector' ? quote.exact : '';
              const lastTurn = [...c.thread].reverse().find((t) => t.text);
              return (
                <li key={c.id} className="orphans-tray-item">
                  <blockquote className="orphans-tray-quote">{exact}</blockquote>
                  {lastTurn && (
                    <p className="orphans-tray-thread">
                      <span className="orphans-tray-role">
                        {lastTurn.role === 'user' ? 'You' : 'Assistant'}:
                      </span>{' '}
                      {truncate(lastTurn.text, 140)}
                    </p>
                  )}
                  <div className="orphans-tray-actions">
                    <button
                      type="button"
                      className="orphans-tray-btn orphans-tray-btn-primary"
                      onClick={() => onReanchor(c.id)}
                    >
                      Re-anchor here
                    </button>
                    <button
                      type="button"
                      className="orphans-tray-btn"
                      onClick={() => onDismiss(c.id)}
                    >
                      Dismiss
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}
