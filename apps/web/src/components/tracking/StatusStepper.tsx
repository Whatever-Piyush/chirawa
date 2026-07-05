'use client';

// 5-phase tracking stepper (mirrors the app). `cancelled` is rendered by the
// parent as a banner instead.
const PHASES = [
  { key: 'placed', icon: '🧾', label: 'ऑर्डर मिला' },
  { key: 'preparing', icon: '👨‍🍳', label: 'तैयार हो रहा है' },
  { key: 'pickup', icon: '📦', label: 'पिकअप' },
  { key: 'onway', icon: '🛵', label: 'रास्ते में' },
  { key: 'delivered', icon: '✅', label: 'डिलीवर हुआ' },
] as const;

function phaseIndex(status: string): number {
  switch (status) {
    case 'pending_payment':
    case 'paid':
    case 'confirmed':
      return 0;
    case 'preparing':
      return 1;
    case 'ready_for_pickup':
    case 'picked_up':
      return 2;
    case 'out_for_delivery':
      return 3;
    case 'delivered':
      return 4;
    default:
      return 0;
  }
}

export function StatusStepper({ status }: { status: string }) {
  const active = phaseIndex(status);

  return (
    <ol className="flex items-start justify-between gap-1">
      {PHASES.map((p, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <li key={p.key} className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
            <span className="flex w-full items-center">
              <span
                className={`h-0.5 flex-1 ${i === 0 ? 'opacity-0' : done || current ? 'bg-success' : 'bg-hairline'}`}
              />
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 text-md ${
                  done
                    ? 'border-success bg-success-light'
                    : current
                      ? 'border-primary bg-primary-light'
                      : 'border-hairline bg-surface'
                }`}
                aria-hidden
              >
                {done ? '✓' : p.icon}
              </span>
              <span
                className={`h-0.5 flex-1 ${i === PHASES.length - 1 ? 'opacity-0' : done ? 'bg-success' : 'bg-hairline'}`}
              />
            </span>
            <span
              className={`text-xxs leading-tight ${
                current ? 'font-bold text-primary' : done ? 'font-semibold text-success' : 'text-ink-faint'
              }`}
            >
              {p.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
