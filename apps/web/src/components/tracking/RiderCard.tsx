'use client';

export function RiderCard({
  rider,
  location,
}: {
  rider: { name: string; phone: string };
  location: { lat: number; lng: number } | null;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-hairline bg-surface p-3 shadow-card">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary-light text-xl" aria-hidden>
        🛵
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-ink">{rider.name}</span>
        <span className="block text-xs text-ink-muted">आपका राइडर</span>
      </span>
      {location && (
        <a
          href={`https://www.google.com/maps?q=${location.lat},${location.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted"
        >
          🗺️ मैप
        </a>
      )}
      <a
        href={`tel:${rider.phone}`}
        className="rounded-full bg-success px-3.5 py-1.5 text-xs font-bold text-white"
      >
        📞 कॉल करें
      </a>
    </div>
  );
}
