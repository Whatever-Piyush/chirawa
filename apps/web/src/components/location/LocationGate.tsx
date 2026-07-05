'use client';

import { useState } from 'react';
import { useLocation } from '@/context/LocationContext';
import { useT } from '@/i18n/provider';
import { Button } from '@/components/ui/Button';

// Soft serviceability gate: a client-only overlay. The page behind it still
// renders server-side (crawlers get full content). Shown until an in-area
// location is chosen, or when the user reopens it from the LocationPill.
export function LocationGate() {
  const { ready, choice, gateOpen, detecting, error, detectViaGps, setPincode, closeGate } =
    useLocation();
  const t = useT();
  const [pin, setPin] = useState('');

  const outOfArea = choice !== null && !choice.serviceable;
  const needsChoice = choice === null || outOfArea;
  if (!ready || !(needsChoice || gateOpen)) return null;

  const dismissable = choice !== null && choice.serviceable;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="डिलीवरी लोकेशन"
    >
      <div className="w-full max-w-md rounded-t-2xl bg-surface p-6 shadow-soft sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-heavy text-ink">आपकी डिलीवरी लोकेशन</h2>
            <p className="mt-1 text-sm text-ink-muted">{t('address.locPermBody')}</p>
          </div>
          {dismissable && (
            <button
              type="button"
              onClick={closeGate}
              aria-label="बंद करें"
              className="-mr-1 -mt-1 rounded-full p-1 text-lg text-ink-faint hover:bg-surface-alt"
            >
              ✕
            </button>
          )}
        </div>

        {outOfArea && (
          <div className="mt-4 rounded-lg bg-primary-light p-3 text-sm text-ink">
            {t('address.comingSoon')}
          </div>
        )}

        <div className="mt-5 space-y-3">
          <Button onClick={detectViaGps} disabled={detecting} className="w-full">
            {detecting ? 'ढूंढ रहे हैं…' : `📍 ${t('address.enableLocation')}`}
          </Button>

          <div className="flex items-center gap-3 text-xs text-ink-faint">
            <span className="h-px flex-1 bg-hairline" />
            या
            <span className="h-px flex-1 bg-hairline" />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (setPincode(pin)) setPin('');
            }}
            className="flex gap-2"
          >
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="पिनकोड (जैसे 333026)"
              aria-label="पिनकोड"
              className="h-11 flex-1 rounded-full border border-hairline bg-cream px-4 text-md text-ink outline-none focus:border-primary"
            />
            <Button type="submit" variant="secondary" disabled={pin.length !== 6}>
              जाएँ
            </Button>
          </form>

          {error === 'invalid-pincode' && (
            <p className="text-sm text-danger">कृपया सही 6-अंकों का पिनकोड डालें।</p>
          )}
          {(error === 'permission-denied' || error === 'geolocation-unavailable') && (
            <p className="text-sm text-danger">{t('address.locPermBody')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
