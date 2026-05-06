import './QuickActions.css';

const PROMPTS = [
  'Make it tighter',
  'Add a concrete example',
  'Why does this matter?',
  'Reword more directly',
];

type Props = {
  onPick: (prompt: string) => void;
  disabled?: boolean;
};

export default function QuickActions({ onPick, disabled }: Props) {
  return (
    <div className="quick-actions" role="group" aria-label="Quick follow-ups">
      {PROMPTS.map((p) => (
        <button
          key={p}
          type="button"
          className="quick-action-btn"
          onClick={() => onPick(p)}
          disabled={disabled}
        >
          {p}
        </button>
      ))}
    </div>
  );
}
