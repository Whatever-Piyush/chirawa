import type { Metadata } from 'next';
import { OrderClient } from '@/components/tracking/OrderClient';

// Gated by middleware; ownership enforced by the backend on every fetch.
export const metadata: Metadata = {
  title: 'ऑर्डर ट्रैकिंग',
  robots: { index: false },
};

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  const { orderId } = await params;
  const { group } = await searchParams;
  return <OrderClient orderId={orderId} groupId={group ?? null} />;
}
