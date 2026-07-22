'use client';

import { useEffect, useState } from 'react';

export interface EtaState {
  secondsRemaining: number;
  spreadSeconds: number;
  receivedAtMs: number; // client clock when this ETA arrived (skew-safe countdown)
}

// Live countdown hero: "~12–15 मिनट में". Counts down client-side from the
// moment the ETA payload arrived.
export function EtaHero({ eta }: { eta: EtaState }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = (Date.now() - eta.receivedAtMs) / 1000;
  const remaining = Math.max(0, eta.secondsRemaining - elapsed);
  const loMin = Math.max(1, Math.floor(remaining / 60));
  const hiMin = Math.max(loMin, Math.ceil((remaining + eta.spreadSeconds) / 60));

  return (
    <div className="rounded-xl bg-brand-warm px-4 py-3 text-white shadow-soft">
      {remaining <= 30 ? (
        <p className="text-lg font-heavy">बस पहुँचने ही वाला है! 🛵</p>
      ) : (
        <p className="text-lg font-heavy">
          ~{loMin === hiMin ? loMin : `${loMin}–${hiMin}`} मिनट में पहुँचेगा
        </p>
      )}
      <p className="text-xs text-white/85">लाइव अपडेट होता रहेगा</p>
    </div>
  );
}
