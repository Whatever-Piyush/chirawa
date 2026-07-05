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
// callers update the guest cart immediately (no server round-trip).
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
        className={`${h} tap-highlight-none rounded-full border border-primary bg-primary-light px-5 text-sm font-bold uppercase tracking-wide text-primary transition-all duration-200 ease-spring hover:bg-primary hover:text-white hover:shadow-primary active:scale-90 disabled:pointer-events-none disabled:opacity-50`}
      >
        {addLabel}
      </button>
    );
  }

  return (
    <div className={`${h} inline-flex animate-pop items-center rounded-full bg-primary font-bold text-white shadow-primary`}>
      <button
        type="button"
        onClick={onDecrement}
        aria-label="कम करें"
        className="tap-highlight-none grid h-full w-8 place-items-center rounded-l-full text-lg transition-colors hover:bg-white/15 active:bg-white/25"
      >
        −
      </button>
      <span key={quantity} className="min-w-[1.5rem] animate-pop text-center text-sm tabular-nums">
        {quantity}
      </span>
      <button
        type="button"
        onClick={onIncrement}
        disabled={disabled}
        aria-label="और जोड़ें"
        className="tap-highlight-none grid h-full w-8 place-items-center rounded-r-full text-lg transition-colors hover:bg-white/15 active:bg-white/25 disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
