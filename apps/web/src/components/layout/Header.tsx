'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LocationPill } from '@/components/layout/LocationPill';

const HINT_WORDS = ['दूध', 'आटा', 'सब्ज़ियाँ', 'बिस्कुट', 'मसाले', 'तेल', 'चावल'];

// Rotating search hint — the Blinkit-style "living" search bar.
function RotatingHint() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const id = setInterval(() => setI((n) => (n + 1) % HINT_WORDS.length), 2400);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="text-sm text-ink-muted">
      ढूंढो{' '}
      <span key={HINT_WORDS[i]} className="inline-block animate-fade-up font-semibold text-ink">
        &ldquo;{HINT_WORDS[i]}&rdquo;
      </span>
    </span>
  );
}

// Sticky brand header: warm gradient, condenses + gains depth once the page
// scrolls, elevated search launcher, location + account on the right.
export function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-30 bg-brand-gradient text-white transition-shadow duration-300 ${
        scrolled ? 'shadow-lift' : ''
      }`}
    >
      <div
        className={`mx-auto flex w-full max-w-content flex-col gap-2.5 px-4 transition-all duration-300 ease-spring ${
          scrolled ? 'py-2' : 'py-3'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="tap-highlight-none flex items-baseline gap-1.5"
            aria-label="Bringly होम"
          >
            <span className="text-xxl font-heavy tracking-tight drop-shadow-sm">Bringly</span>
            <span className="hidden text-xs font-medium text-white/85 sm:inline">चिरावा</span>
          </Link>

          <div className="flex items-center gap-2">
            <LocationPill />
            <Link
              href="/account"
              aria-label="मेरा अकाउंट"
              className="tap-highlight-none grid h-9 w-9 place-items-center rounded-full bg-white/15 text-lg transition-all duration-200 hover:scale-105 hover:bg-white/25 active:scale-95"
            >
              👤
            </Link>
          </div>
        </div>

        <Link
          href="/search"
          className="tap-highlight-none group flex items-center gap-2.5 rounded-full bg-white px-4 py-2.5 shadow-soft transition-all duration-300 ease-spring hover:shadow-lift"
        >
          <span className="transition-transform duration-300 group-hover:scale-110" aria-hidden>
            🔍
          </span>
          <RotatingHint />
        </Link>
      </div>
    </header>
  );
}
