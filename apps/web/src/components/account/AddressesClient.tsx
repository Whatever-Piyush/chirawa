'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddressResponse } from '@chirawa/types';
import { browserApi } from '@/lib/api/browser';
import { AddressForm } from '@/components/checkout/AddressForm';

function line(a: AddressResponse): string {
  return [a.street, a.landmark !== '-' ? a.landmark : null, a.locality, a.pincode]
    .filter(Boolean)
    .join(', ');
}

export function AddressesClient() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: addresses, isPending } = useQuery({
    queryKey: ['addresses'],
    queryFn: () => browserApi.getAddresses(),
    staleTime: 0,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['addresses'] });

  const remove = async (id: string) => {
    if (!window.confirm('यह पता हटाएं?')) return;
    setBusyId(id);
    setError(null);
    try {
      await browserApi.deleteAddress(id);
      await invalidate();
    } catch {
      setError('पता नहीं हटा — दोबारा कोशिश करें');
    } finally {
      setBusyId(null);
    }
  };

  const makeDefault = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await browserApi.setDefaultAddress(id);
      await invalidate();
    } catch {
      setError('डिफ़ॉल्ट सेट नहीं हुआ — दोबारा कोशिश करें');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 pb-28">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-heavy text-ink">मेरे पते</h1>
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

      {adding && (
        <AddressForm
          onSaved={() => {
            setAdding(false);
            void invalidate();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {isPending ? (
        <div className="mt-3 space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-alt" />
          ))}
        </div>
      ) : !addresses || addresses.length === 0 ? (
        !adding && (
          <div className="grid place-items-center py-16 text-center">
            <p className="text-4xl" aria-hidden>
              📍
            </p>
            <p className="mt-2 text-sm text-ink-muted">कोई पता सेव नहीं है</p>
          </div>
        )
      ) : (
        <div className="mt-3 space-y-3">
          {addresses.map((a) => (
            <div key={a.id} className="rounded-xl border border-hairline bg-surface p-4 shadow-card">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-ink">{a.label ?? 'पता'}</span>
                {a.isDefault && (
                  <span className="rounded-full bg-success-light px-1.5 py-0.5 text-xxs font-bold text-success">
                    डिफ़ॉल्ट
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{line(a)}</p>
              {a.receiverName && (
                <p className="mt-0.5 text-xs text-ink-faint">
                  👤 {a.receiverName}
                  {a.receiverPhone ? ` · ${a.receiverPhone}` : ''}
                </p>
              )}
              <div className="mt-2.5 flex gap-2">
                {!a.isDefault && (
                  <button
                    type="button"
                    disabled={busyId === a.id}
                    onClick={() => void makeDefault(a.id)}
                    className="rounded-full border border-hairline px-3 py-1.5 text-xs font-semibold text-ink-muted hover:border-primary hover:text-primary disabled:opacity-50"
                  >
                    डिफ़ॉल्ट बनाएं
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyId === a.id}
                  onClick={() => void remove(a.id)}
                  className="rounded-full border border-danger px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger-light disabled:opacity-50"
                >
                  हटाएं
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-danger-light px-3 py-2 text-sm font-semibold text-danger">{error}</p>
      )}
    </div>
  );
}
