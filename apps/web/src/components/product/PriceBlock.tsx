import { formatPaise, discountPercent } from '@/lib/format';

// Price + MRP strikethrough + discount pill. Server-safe (no hooks) so the PDP
// can render it in RSC and the purchase island can re-render it with fresh data.
export function PriceBlock({
  pricePaise,
  mrpPaise,
  size = 'lg',
}: {
  pricePaise: number;
  mrpPaise?: number | null;
  size?: 'md' | 'lg';
}) {
  const disc = discountPercent(pricePaise, mrpPaise);
  return (
    <div className="flex items-center gap-2">
      <span className={size === 'lg' ? 'text-xxl font-heavy text-ink' : 'text-lg font-bold text-ink'}>
        {formatPaise(pricePaise)}
      </span>
      {disc > 0 && mrpPaise != null && (
        <>
          <span className="text-md text-ink-faint line-through">{formatPaise(mrpPaise)}</span>
          <span className="rounded-md bg-success-light px-2 py-0.5 text-xs font-bold text-success">
            {disc}% OFF
          </span>
        </>
      )}
    </div>
  );
}
