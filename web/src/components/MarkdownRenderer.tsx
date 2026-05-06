import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSourcePosition from '../lib/rehype-source-position';
import './MarkdownRenderer.css';

type Props = {
  source: string;
};

/* react-markdown 9 renders pure HTML; the rehype plugin emits
 * data-sourcepos attributes on every block element so selection.ts
 * can project a DOM Range back to source-character offsets. */
const MarkdownRenderer = memo(function MarkdownRenderer({ source }: Props) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSourcePosition]}
        // We rely on default mappings — the `data-sourcepos` attribute
        // is added by our rehype pass, no per-component overrides needed.
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownRenderer;
