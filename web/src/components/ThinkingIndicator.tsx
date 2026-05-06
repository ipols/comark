import './ThinkingIndicator.css';

type Props = {
  label?: string;
};

/**
 * Three soft pulsing dots, used while the listener subagent is working
 * on a pending comment. Replaces the old SSE-streamed character cursor —
 * comark no longer streams chunks from the browser side; the answer
 * arrives as a complete turn via the SSE update channel and pops in.
 */
export default function ThinkingIndicator({ label }: Props) {
  return (
    <div className="thinking-indicator" aria-live="polite" role="status">
      <span className="thinking-dots" aria-hidden="true">
        <span className="thinking-dot" />
        <span className="thinking-dot" />
        <span className="thinking-dot" />
      </span>
      {label && <span className="thinking-label">{label}</span>}
    </div>
  );
}
