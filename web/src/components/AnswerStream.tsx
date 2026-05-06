import { useEffect, useState } from 'react';
import { streamLlmAnswer, type LlmStreamRequest } from '../lib/api';
import './AnswerStream.css';

type Props = {
  docId: string;
  request: LlmStreamRequest;
  onComplete: (text: string, model?: string) => void;
  onError: (message: string) => void;
};

/* Streams the SSE response and renders it progressively with a soft caret.
 * The caret pulses; text fills in chunk-by-chunk. The component owns the
 * accumulating buffer; parent receives final text on completion or error. */
export default function AnswerStream({ docId, request, onComplete, onError }: Props) {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'connecting' | 'streaming' | 'complete' | 'error'>('connecting');

  useEffect(() => {
    let acc = '';
    const abort = streamLlmAnswer(docId, request, (e) => {
      if (e.type === 'chunk') {
        acc += e.text;
        setText(acc);
        setPhase((p) => (p === 'connecting' ? 'streaming' : p));
      } else if (e.type === 'complete') {
        const finalText = e.text || acc;
        setText(finalText);
        setPhase('complete');
        onComplete(finalText, e.model);
      } else if (e.type === 'error') {
        setPhase('error');
        onError(e.message);
      }
    });
    return () => abort();
    // We deliberately ignore identity changes on onComplete/onError to avoid
    // re-running the stream; parent should keep them stable via useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, request.commentId, request.comment]);

  return (
    <div className="answer-stream" data-phase={phase} aria-live="polite">
      {text ? (
        <p className="answer-stream-text">
          {text}
          {phase === 'streaming' && <span className="answer-stream-cursor" aria-hidden="true" />}
        </p>
      ) : (
        <p className="answer-stream-pending">
          <span className="answer-stream-dot" />
          <span className="answer-stream-dot" />
          <span className="answer-stream-dot" />
        </p>
      )}
    </div>
  );
}
