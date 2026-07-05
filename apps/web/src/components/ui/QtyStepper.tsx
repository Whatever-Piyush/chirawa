'use client';

type Props = {
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
  disabled?: boolean;
  addLabel?: string;
  size?: 'sm' | 'md';
};

// When quantity is 0 → an "ADD" pill; otherwise the −/qty/+ stepper. Optimistic:
// callers update the guest cart immediately (no server round-trip in Task 5).
export function QtyStepper({
  quantity,
  onIncrement,
  onDecrement,
  disabled = false,
  addLabel = 'ADD',
  size = 'md',
}: Props) {
  const h = size === 'sm' ? 'h-8' : 'h-9';

  if (quantity <= 0) {
    return (
      <button
        type="button"
        onClick={onIncrement}
        disabled={disabled}
        className={`${h} rounded-full border border-primary bg-primary-light px-5 text-sm font-bold uppercase tracking-wide text-primary transition-colors hover:bg-primary hover:text-white disabled:pointer-events-none disabled:opacity-50`}
      >
        {addLabel}
      </button>
    );
  }

  return (
    <div className={`${h} inline-flex items-center rounded-full bg-primary font-bold text-white`}>
      <button
        type="button"
        onClick={onDecrement}
        aria-label="कम करें"
        className="grid h-full w-8 place-items-center text-lg"
      >
        −
      </button>
      <span className="min-w-[1.5rem] text-center text-sm tabular-nums">{quantity}</span>
      <button
        type="button"
        onClick={onIncrement}
        disabled={disabled}
        aria-label="और जोड़ें"
        className="grid h-full w-8 place-items-center text-lg disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
