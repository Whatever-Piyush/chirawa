import type { Metadata } from 'next';
import { CartPageClient } from '@/components/cart/CartPageClient';

// Guest cart lives in localStorage — pure CSR, out of the index (plan §6).
export const metadata: Metadata = {
  title: 'आपकी कार्ट',
  robots: { index: false },
};

export default function CartPage() {
  return <CartPageClient />;
}
