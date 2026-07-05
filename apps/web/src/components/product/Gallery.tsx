'use client';

import Image from 'next/image';
import { useState } from 'react';

// PDP image gallery: big main image + clickable thumbnails (the web analogue of
// the app's swipe carousel with dots).
export function Gallery({ images, name }: { images: string[]; name: string }) {
  const [active, setActive] = useState(0);

  if (images.length === 0) {
    return (
      <div className="grid aspect-square w-full place-items-center rounded-xl border border-hairline bg-surface">
        <span className="text-6xl font-heavy text-primary" aria-hidden>
          {name.charAt(0).toUpperCase()}
        </span>
      </div>
    );
  }

  const main = images[Math.min(active, images.length - 1)]!;

  return (
    <div>
      <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-hairline bg-surface">
        <Image
          src={main}
          alt={name}
          fill
          priority
          sizes="(min-width: 768px) 50vw, 100vw"
          className="object-contain p-6"
        />
        {images.length > 1 && (
          <span className="absolute right-3 top-3 rounded-full bg-black/45 px-2.5 py-0.5 text-xs font-semibold text-white">
            {Math.min(active, images.length - 1) + 1}/{images.length}
          </span>
        )}
      </div>

      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {images.map((url, i) => (
            <button
              key={`${url}-${i}`}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`फ़ोटो ${i + 1}`}
              className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 bg-surface ${
                i === active ? 'border-primary' : 'border-hairline'
              }`}
            >
              <Image src={url} alt="" fill sizes="64px" className="object-contain p-1" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
