import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Button } from '@/components/ui/Button';
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

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-content px-4 py-6 pb-28">
      <section className="overflow-hidden rounded-xl bg-brand-warm px-6 py-8 text-white shadow-soft">
        <h1 className="text-xxxl font-heavy leading-tight">मिनटों में किराना, आपके दरवाज़े तक</h1>
        <p className="mt-2 max-w-md text-md text-white/90">
          चिरावा की दुकानों से ताज़ा सामान ऑर्डर करें — डिलीवरी पर नकद भुगतान।
        </p>
        <div className="mt-5">
          <Button variant="secondary" size="lg">
            अभी खरीदें
          </Button>
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
