import type { Metadata } from 'next';
import { OrdersClient } from '@/components/account/OrdersClient';

// Gated by middleware.
export const metadata: Metadata = {
  title: 'मेरे ऑर्डर',
  robots: { index: false },
};

export default function OrdersPage() {
  return <OrdersClient />;
}
