import Link from 'next/link';
import { T } from '@/i18n/T';
import { LocationPill } from '@/components/layout/LocationPill';

// Brand header with the warm gradient, a delivery-location pill and a search
// launcher. All three are static placeholders in Task 1 — the location gate
// (Task 4) and search (Task 9) wire them up later.
export function Header() {
  return (
    <header className="bg-brand-gradient text-white">
      <div className="mx-auto flex w-full max-w-content flex-col gap-3 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-baseline gap-1.5" aria-label="Bringly होम">
            <span className="text-xxl font-heavy tracking-tight">Bringly</span>
            <span className="text-xs font-medium text-white/80">चिरावा</span>
          </Link>

          <LocationPill />
        </div>

        {/* Search launcher → /search (Task 9). */}
        <Link
          href="/search"
          className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-ink-muted shadow-sm transition-shadow hover:shadow-md"
        >
          <span aria-hidden>🔍</span>
          <span className="text-sm">
            <T k="home.searchPlaceholder" />
          </span>
        </Link>
      </div>
    </header>
  );
}
