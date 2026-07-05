'use client';

import type { PricingPreviewResponse } from '@chirawa/types';
import { formatPaise } from '@/lib/format';

export function BillSummary({ preview }: { preview: PricingPreviewResponse }) {
  return (
    <div>
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-muted">उप-कुल</dt>
          <dd className="font-semibold text-ink">{formatPaise(preview.cartSubtotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-muted">
            डिलीवरी शुल्क{' '}
            <span className="text-xs text-ink-faint">({preview.distanceKm.toFixed(1)} किमी)</span>
          </dt>
          <dd className={preview.deliveryFee === 0 ? 'font-bold text-success' : 'font-semibold text-ink'}>
            {preview.deliveryFee === 0 ? 'मुफ्त' : formatPaise(preview.deliveryFee)}
          </dd>
        </div>
        {preview.discount > 0 && (
          <div className="flex justify-between text-success">
            <dt>
              छूट{preview.appliedPromoCode ? ` (${preview.appliedPromoCode})` : ''}
            </dt>
            <dd className="font-semibold">−{formatPaise(preview.discount)}</dd>
          </div>
        )}
      </dl>

      <div className="mt-3 flex justify-between border-t border-divider pt-3 text-md font-bold text-ink">
        <span>कुल</span>
        <span>{formatPaise(preview.total)}</span>
      </div>

      {preview.breakdownText && (
        <p className="mt-2 rounded-lg bg-primary-light/50 px-3 py-2 text-xs leading-relaxed text-ink-muted">
          {preview.breakdownText}
        </p>
      )}
    </div>
  );
}
