import type { HTMLAttributes } from 'react';

// Rounded, warm-bordered surface card. Server-safe (no client hooks) so it can
// be used freely inside RSC pages.
export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-hairline bg-surface shadow-card ${className}`}
      {...props}
    />
  );
}
