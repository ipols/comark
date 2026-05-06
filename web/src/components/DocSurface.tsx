import { useMemo, useState } from 'react';
import type { DocPayload } from '../types';
import MarkdownRenderer from './MarkdownRenderer';
import './DocSurface.css';

type Props = {
  doc: DocPayload;
};

export default function DocSurface({ doc }: Props) {
  const [contextOpen, setContextOpen] = useState(false);
  const fileName = useMemo(() => extractFileName(doc.filePath), [doc.filePath]);
  const commentSummary = useMemo(() => summarizeComments(doc.comments), [doc.comments]);

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
        <article className="doc-article">
          <MarkdownRenderer source={doc.content} />
        </article>
      </main>
    </div>
  );
}

function extractFileName(p: string): string {
  if (!p) return 'untitled.md';
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

function summarizeComments(
  comments: DocPayload['comments'],
): string | null {
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
