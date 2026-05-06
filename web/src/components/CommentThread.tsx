import { useCallback, useState } from 'react';
import type { Comment, Selector, ThreadTurn } from '../types';
import { saveComment, type LlmStreamRequest } from '../lib/api';
import AnswerStream from './AnswerStream';
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

export default function CommentThread({
  docId,
  comment,
  isActive,
  onUpdate,
  onActivate,
  onCloseActive,
}: Props) {
  const [followUp, setFollowUp] = useState('');
  const [streamRequest, setStreamRequest] = useState<LlmStreamRequest | null>(
    () => initialRequestForPending(comment),
  );
  const [actionInflight, setActionInflight] = useState(false);

  const uiState = comment.uiState ?? 'idle';
  const quoteSelector = comment.target.selectors.find((s) => s.type === 'TextQuoteSelector');

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

  const handleStreamComplete = useCallback(
    (text: string, model?: string) => {
      const newAssistantTurn: ThreadTurn = { role: 'assistant', text, state: 'complete' };
      const updatedThread = upsertAssistantTurn(comment.thread, newAssistantTurn);
      onUpdate({
        ...comment,
        uiState: 'answer-ready',
        thread: updatedThread,
        ...(model ? {} : {}),
      });
      setStreamRequest(null);
    },
    [comment, onUpdate],
  );

  const handleStreamError = useCallback(
    (message: string) => {
      onUpdate({ ...comment, uiState: 'error', lastError: message });
      setStreamRequest(null);
    },
    [comment, onUpdate],
  );

  const submitFollowUp = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const updatedThread: ThreadTurn[] = [
        ...comment.thread,
        { role: 'user', text, kind: 'follow-up' },
      ];
      const next: Comment = { ...comment, uiState: 'pending', thread: updatedThread };
      onUpdate(next);
      setFollowUp('');
      setStreamRequest({
        commentId: comment.id,
        comment: text,
        selection: quoteSelector,
      });
    },
    [comment, onUpdate, quoteSelector],
  );

  const submitQuickAction = useCallback(
    (prompt: string) => {
      void submitFollowUp(prompt);
    },
    [submitFollowUp],
  );

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
        {streamRequest && (
          <div className="comment-thread-turn comment-thread-turn-assistant">
            <AnswerStream
              docId={docId}
              request={streamRequest}
              onComplete={handleStreamComplete}
              onError={handleStreamError}
            />
          </div>
        )}
      </div>

      {uiState === 'error' && comment.lastError && (
        <div className="comment-thread-error" role="alert">
          {comment.lastError}
          <button
            type="button"
            className="comment-thread-link"
            onClick={() => {
              const lastUser = [...comment.thread].reverse().find((t) => t.role === 'user');
              if (!lastUser) return;
              onUpdate({ ...comment, uiState: 'pending', lastError: undefined });
              setStreamRequest({
                commentId: comment.id,
                comment: lastUser.text,
                selection: quoteSelector,
              });
            }}
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

function initialRequestForPending(c: Comment): LlmStreamRequest | null {
  if (c.uiState !== 'pending') return null;
  const lastUser = [...c.thread].reverse().find((t) => t.role === 'user');
  if (!lastUser) return null;
  return {
    commentId: c.id,
    comment: lastUser.text,
    selection: c.target.selectors.find((s) => s.type === 'TextQuoteSelector') ?? null,
  };
}

function upsertAssistantTurn(thread: ThreadTurn[], next: ThreadTurn): ThreadTurn[] {
  const last = thread[thread.length - 1];
  if (last?.role === 'assistant' && last.state !== 'complete') {
    return [...thread.slice(0, -1), next];
  }
  return [...thread, next];
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
    <div
      className={`comment-thread-turn comment-thread-turn-${turn.role}`}
    >
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
