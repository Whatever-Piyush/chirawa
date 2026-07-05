'use client';

import { useRef, type ReactNode } from 'react';

// Horizontal rail with snap scrolling, faded clip edges (.rail-track) and
// desktop arrow paddles. Children are rendered by the server (RSC) — this
// wrapper only owns scrolling.
export function RailScroller({ children }: { children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);

  const nudge = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <div className="group/rail relative">
      <div ref={track} className="rail-track -mx-4 px-4">
        {children}
      </div>

      {/* Desktop paddles — appear on rail hover */}
      <button
        type="button"
        aria-label="पीछे"
        onClick={() => nudge(-1)}
        className="absolute -left-3 top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-hairline bg-white text-ink shadow-lift opacity-0 transition-all duration-200 hover:scale-110 group-hover/rail:opacity-100 md:grid"
      >
        ‹
      </button>
      <button
        type="button"
        aria-label="आगे"
        onClick={() => nudge(1)}
        className="absolute -right-3 top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-hairline bg-white text-ink shadow-lift opacity-0 transition-all duration-200 hover:scale-110 group-hover/rail:opacity-100 md:grid"
      >
        ›
      </button>
    </div>
  );
}
