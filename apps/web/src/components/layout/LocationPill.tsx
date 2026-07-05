'use client';

import { useLocation } from '@/context/LocationContext';
import { useT } from '@/i18n/provider';

// Delivery-location pill in the header. Tapping it reopens the LocationGate.
export function LocationPill() {
  const { choice, openGate } = useLocation();
  const t = useT();
  const label = choice?.serviceable && choice.label ? choice.label : t('home.location');

  return (
    <button
      type="button"
      onClick={openGate}
      aria-label="लोकेशन बदलें"
      className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm transition-colors hover:bg-white/25"
    >
      <span aria-hidden>📍</span>
      <span className="max-w-[9rem] truncate font-medium">{label}</span>
      <span aria-hidden className="text-xs opacity-80">
        ▾
      </span>
    </button>
  );
}
