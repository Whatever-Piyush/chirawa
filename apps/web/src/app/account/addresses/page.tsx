import type { Metadata } from 'next';
import { AddressesClient } from '@/components/account/AddressesClient';

// Gated by middleware.
export const metadata: Metadata = {
  title: 'मेरे पते',
  robots: { index: false },
};

export default function AddressesPage() {
  return <AddressesClient />;
}
