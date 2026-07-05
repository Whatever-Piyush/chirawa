import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CategoryGrid,
  DailyEssentials,
  NearbyShops,
  ChirawaSpecials,
  Bestsellers,
  ForYouFeed,
} from '@/components/home/sections';
import { ShelfSkeleton, GridSkeleton } from '@/components/home/skeletons';

// ISR: statically generated, revalidated every 2 min. force-cache makes the
// api-client's plain fetches cacheable (it can't set Next cache hints itself),
// which is what keeps this page static rather than dynamic.
export const revalidate = 120;
export const fetchCache = 'force-cache';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Bringly — ताज़ा किराना, आपके दरवाज़े तक',
    description: 'चिरावा की दुकानों से किराना ऑर्डर करें। डिलीवरी पर नकद भुगतान।',
    type: 'website',
  },
};

// Floating grocery motifs on the hero — pure markup, zero external assets
// (CSP stays 'self'-only). Hidden from screen readers; decorative.
const HERO_FLOATS = [
  { emoji: '🥛', className: 'right-[8%] top-[12%]', tilt: '-6deg', delay: '0s' },
  { emoji: '🍅', className: 'right-[22%] top-[52%]', tilt: '8deg', delay: '1.1s' },
  { emoji: '🥬', className: 'right-[38%] top-[18%]', tilt: '-10deg', delay: '0.5s' },
  { emoji: '🍞', className: 'right-[6%] top-[62%]', tilt: '5deg', delay: '1.7s' },
] as const;

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-content px-4 py-6 pb-28">
      <section className="relative isolate overflow-hidden rounded-[1.75rem] bg-hero-warm px-6 py-10 text-white shadow-lift sm:px-10 sm:py-14">
        {/* Decorative floating tiles (desktop) */}
        <div className="pointer-events-none absolute inset-0 hidden sm:block" aria-hidden>
          {HERO_FLOATS.map((f) => (
            <span
              key={f.emoji}
              className={`absolute grid h-16 w-16 animate-float place-items-center rounded-2xl border border-white/25 bg-white/15 text-3xl shadow-soft backdrop-blur-sm ${f.className}`}
              style={{ ['--float-tilt' as string]: f.tilt, animationDelay: f.delay }}
            >
              {f.emoji}
            </span>
          ))}
        </div>

        <div className="relative max-w-xl">
          <p className="inline-flex animate-fade-up items-center gap-1.5 rounded-full border border-white/30 bg-white/15 px-3 py-1 text-xs font-bold tracking-wide backdrop-blur-sm">
            ⚡ चिरावा का अपना क्विक-डिलीवरी स्टोर
          </p>
          <h1 className="mt-4 animate-fade-up text-hero font-heavy leading-[1.1] tracking-tight drop-shadow-sm [animation-delay:80ms]">
            मिनटों में किराना,
            <br />
            आपके दरवाज़े तक
          </h1>
          <p className="mt-3 max-w-md animate-fade-up text-md leading-relaxed text-white/90 [animation-delay:160ms]">
            चिरावा की अपनी दुकानों से ताज़ा सामान — ऑर्डर करें, और डिलीवरी पर नकद भुगतान करें।
          </p>

          <div className="mt-6 flex animate-fade-up flex-wrap items-center gap-3 [animation-delay:240ms]">
            <a
              href="#categories"
              className="tap-highlight-none inline-flex h-12 items-center rounded-full bg-white px-7 text-md font-bold text-primary shadow-lift transition-all duration-300 ease-spring hover:scale-[1.03] hover:shadow-glow active:scale-95"
            >
              खरीदारी शुरू करें
            </a>
            <Link
              href="/search"
              className="tap-highlight-none inline-flex h-12 items-center gap-2 rounded-full border-2 border-white/60 px-6 text-md font-bold text-white transition-all duration-300 hover:border-white hover:bg-white/10 active:scale-95"
            >
              🔍 कुछ ढूंढें
            </Link>
          </div>

          <div className="mt-7 flex animate-fade-up flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-white/90 [animation-delay:320ms]">
            <span className="inline-flex items-center gap-1.5">⏱ 10–30 मिनट में</span>
            <span className="inline-flex items-center gap-1.5">💵 डिलीवरी पर नकद</span>
            <span className="inline-flex items-center gap-1.5">🏪 लोकल दुकानें</span>
          </div>
        </div>
      </section>

      <Suspense fallback={<GridSkeleton />}>
        <CategoryGrid />
      </Suspense>

      <Suspense fallback={<ShelfSkeleton title="रोज़मर्रा का सामान" />}>
        <DailyEssentials />
      </Suspense>

      <Suspense fallback={<ShelfSkeleton title="आस-पास की दुकानें" />}>
        <NearbyShops />
      </Suspense>

      <Suspense fallback={<ShelfSkeleton title="चिरावा स्पेशल" />}>
        <ChirawaSpecials />
      </Suspense>

      <Suspense fallback={<GridSkeleton />}>
        <Bestsellers />
      </Suspense>

      <Suspense fallback={<ShelfSkeleton title="आपके लिए" />}>
        <ForYouFeed />
      </Suspense>
    </div>
  );
}
