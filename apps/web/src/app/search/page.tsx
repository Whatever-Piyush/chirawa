import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SearchClient } from '@/components/search/SearchClient';

// Interactive search is CSR and stays out of the index (plan §6).
export const metadata: Metadata = {
  title: 'खोजें',
  robots: { index: false, follow: true },
};

export default function SearchPage() {
  // useSearchParams in the client tree requires a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <SearchClient />
    </Suspense>
  );
}
