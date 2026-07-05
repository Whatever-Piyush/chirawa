'use client';

import { useState } from 'react';
import type { AddressResponse } from '@chirawa/types';
import { AddressForm } from '@/components/checkout/AddressForm';

function line(a: AddressResponse): string {
  return [a.street, a.landmark !== '-' ? a.landmark : null, a.locality, a.pincode]
    .filter(Boolean)
    .join(', ');
}

export function AddressPicker({
  addresses,
  selectedId,
  onSelect,
  onCreated,
}: {
  addresses: AddressResponse[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreated: (id: string) => void;
}) {
  const [adding, setAdding] = useState(addresses.length === 0);

  return (
    <section className="rounded-xl border border-hairline bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-md font-bold text-ink">डिलीवरी पता</h2>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-sm font-semibold text-primary hover:underline"
          >
            + नया पता
          </button>
        )}
      </div>

      {addresses.length > 0 && (
        <div className="mt-2 space-y-2">
          {addresses.map((a) => (
            <label
              key={a.id}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition-colors ${
                selectedId === a.id ? 'border-primary bg-primary-light/40' : 'border-hairline'
              }`}
            >
              <input
                type="radio"
                name="address"
                checked={selectedId === a.id}
                onChange={() => onSelect(a.id)}
                className="mt-1 accent-primary"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-bold text-ink">
                  {a.label ?? 'पता'}
                  {a.isDefault && (
                    <span className="rounded-full bg-success-light px-1.5 py-0.5 text-xxs font-bold text-success">
                      डिफ़ॉल्ट
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{line(a)}</span>
                {a.receiverName && (
                  <span className="mt-0.5 block text-xs text-ink-faint">
                    👤 {a.receiverName}
                    {a.receiverPhone ? ` · ${a.receiverPhone}` : ''}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}

      {adding && (
        <AddressForm
          onSaved={(id) => {
            setAdding(false);
            onCreated(id);
          }}
          {...(addresses.length > 0 ? { onCancel: () => setAdding(false) } : {})}
        />
      )}
    </section>
  );
}
