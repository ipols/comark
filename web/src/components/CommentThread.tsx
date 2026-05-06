import { useCallback, useState } from 'react';
import type { Comment, Selector, ThreadTurn } from '../types';
import { saveComment } from '../lib/api';
import ThinkingIndicator from './ThinkingIndicator';
import QuickActions from './QuickActions';
import './CommentThread.css';

type Props = {
  docId: string;
  comment: Comment;
  isActive: boolean;
  onUpdate: (next: Comment) => void;
  onActivate: () => void;
  onCloseActive?: () => void;
};

/**
 * Renders the collapsed card OR the expanded thread for a single comment.
 *
 * In the V1.x architecture, the LLM doing the answering is the listener
 * subagent spawned by the chat at hook time — comark's local server doesn't
 * call any LLM directly. That means:
 *   - When the user submits a comment, we POST it with uiState='pending'
 *     and stop. No SSE streaming from this side.
 *   - The listener picks it up via the comark MCP server, generates an
 *     answer using the user's chat-session auth + context, posts it back
 *     via comark_post_answer.
 *   - Sidecar updates → server emits SSE 'update' → the parent's data hook
 *     refetches and we re-render with the assistant turn populated.
 *
 * UI states:
 *   - pending  → "thinking" indicator inline
 *   - error    → red banner + retry/edit/dismiss
 *   - answer-ready → assistant turn rendered, Accept / Refuse / Continue
 *   - resolved/dismissed → terminal
 */
export default function CommentThread({
  docId,
  comment,
  isActive,
  onUpdate,
  onActivate,
  onCloseActive,
}: Props) {
  const [followUp, setFollowUp] = useState('');
  const [actionInflight, setActionInflight] = useState(false);

  const uiState = comment.uiState ?? 'idle';
  const quoteSelector = comment.target.selectors.find((s) => s.type === 'TextQuoteSelector');
  const lastAssistant = [...comment.thread].reverse().find((t) => t.role === 'assistant');
  const hasAnswer = !!lastAssistant && lastAssistant.state !== 'incomplete';
  const isThinking = uiState === 'pending' || uiState === 'answering';

  const persistUpdate = useCallback(
    async (patch: Partial<Comment>) => {
      setActionInflight(true);
      try {
        const next = await saveComment(docId, { ...comment, ...patch });
        onUpdate(next);
      } catch (err) {
        onUpdate({
          ...comment,
          ...patch,
          uiState: 'error',
          lastError: (err as Error).message || 'Save failed',
        });
      } finally {
        setActionInflight(false);
      }
    },
    [docId, comment, onUpdate],
  );

  const submitFollowUp = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const updatedThread: ThreadTurn[] = [
        ...comment.thread,
        { role: 'user', text, kind: 'follow-up' },
      ];
      const next: Comment = { ...comment, uiState: 'pending', thread: updatedThread };
      // Optimistic local update — the server save (via persistUpdate) will reconcile.
      onUpdate(next);
      setFollowUp('');
      // Persist to server so the listener subagent picks it up.
      await persistUpdate({ uiState: 'pending', thread: updatedThread });
    },
    [comment, onUpdate, persistUpdate],
  );

  const submitQuickAction = useCallback(
    (prompt: string) => {
      void submitFollowUp(prompt);
    },
    [submitFollowUp],
  );

  const retryAnswer = useCallback(async () => {
    // Re-trigger the listener: bump uiState back to 'pending' without
    // changing the thread. The listener treats this as a new pending and
    // generates a fresh answer.
    await persistUpdate({ uiState: 'pending', lastError: undefined });
  }, [persistUpdate]);

  if (!isActive) {
    return (
      <button
        type="button"
        className="comment-thread comment-thread-collapsed"
        data-state={uiState}
        onClick={onActivate}
      >
        <ThreadHeader comment={comment} quote={quoteSelector} compact />
        <ThreadPreview comment={comment} />
      </button>
    );
  }

  return (
    <section
      className="comment-thread comment-thread-expanded"
      data-state={uiState}
      aria-label="Comment thread"
    >
      <header className="comment-thread-header">
        <ThreadHeader comment={comment} quote={quoteSelector} />
        {onCloseActive && (
          <button
            type="button"
            className="comment-thread-close"
            onClick={onCloseActive}
            aria-label="Collapse thread"
          >
            ×
          </button>
        )}
      </header>

      <div className="comment-thread-turns">
        {comment.thread.map((turn, i) => (
          <ThreadTurnView key={i} turn={turn} />
        ))}
        {isThinking && !hasAnswer && (
          <div className="comment-thread-turn comment-thread-turn-assistant">
            <ThinkingIndicator label="thinking…" />
          </div>
        )}
      </div>

      {uiState === 'error' && comment.lastError && (
        <div className="comment-thread-error" role="alert">
          {comment.lastError}
          <button
            type="button"
            className="comment-thread-link"
            onClick={retryAnswer}
            disabled={actionInflight}
          >
            Retry
          </button>
        </div>
      )}

      {uiState === 'answer-ready' && (
        <>
          <QuickActions onPick={submitQuickAction} disabled={actionInflight} />
          <FollowUpComposer
            value={followUp}
            onChange={setFollowUp}
            onSubmit={() => submitFollowUp(followUp)}
            disabled={actionInflight}
          />
          <div className="comment-thread-actions">
            <button
              type="button"
              className="comment-thread-btn comment-thread-btn-primary"
              onClick={() => persistUpdate({ uiState: 'resolved', state: 'resolved' })}
              disabled={actionInflight}
            >
              Accept
            </button>
            <button
              type="button"
              className="comment-thread-btn"
              onClick={() => persistUpdate({ uiState: 'dismissed', state: 'dismissed' })}
              disabled={actionInflight}
            >
              Refuse
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function ThreadHeader({
  comment,
  quote,
  compact,
}: {
  comment: Comment;
  quote: Selector | undefined;
  compact?: boolean;
}) {
  const exact = quote?.type === 'TextQuoteSelector' ? quote.exact : '';
  return (
    <div className="thread-header-meta">
      <span className="thread-state-pip" data-state={comment.uiState ?? 'idle'} aria-hidden="true" />
      {!compact && comment.anchorState === 'approximate' && (
        <span className="thread-approximate-tag" title="Re-anchored fuzzy match">~</span>
      )}
      <span className="thread-quote" title={exact}>
        {truncate(exact, compact ? 40 : 80)}
      </span>
    </div>
  );
}

function ThreadPreview({ comment }: { comment: Comment }) {
  const last = [...comment.thread].reverse().find((t) => t.text);
  if (!last) return null;
  return (
    <p className="thread-preview">
      <span className="thread-preview-role">{last.role === 'user' ? 'You' : 'Assistant'}:</span>{' '}
      {truncate(last.text, 100)}
    </p>
  );
}

function ThreadTurnView({ turn }: { turn: ThreadTurn }) {
  const role = turn.role === 'user' ? 'You' : 'Assistant';
  return (
    <div className={`comment-thread-turn comment-thread-turn-${turn.role}`}>
      <span className="thread-turn-role">{role}</span>
      <p className="thread-turn-text">{turn.text}</p>
    </div>
  );
}

function FollowUpComposer({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="thread-followup">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Continue the conversation…"
        rows={2}
        className="thread-followup-input"
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (value.trim()) onSubmit();
          }
        }}
      />
      {value.trim().length > 0 && (
        <button
          type="button"
          className="thread-followup-submit"
          onClick={onSubmit}
          disabled={disabled}
        >
          Send
        </button>
      )}
    </div>
  );
}

function truncate(s: string | undefined, n: number): string {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}
