import type { Metadata } from 'next';
import { CheckoutClient } from '@/components/checkout/CheckoutClient';

// Gated by middleware (no session → /login?next=/checkout). COD only.
export const metadata: Metadata = {
  title: 'चेकआउट',
  robots: { index: false },
};

export default function CheckoutPage() {
  return <CheckoutClient />;
}
