'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { browserApi } from '@/lib/api/browser';
import { useGuestCart } from '@/context/GuestCartContext';
import { formatPaise } from '@/lib/format';

// GET /orders (list) returns a lighter row than OrderDetailResponse — the
// api-client's declared type is wrong for this endpoint (verified against the
// live backend): totals are `totalAmount`, items carry no subtotal.
interface OrderListRow {
  id: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  items: Array<{ productId: string; productName: string; quantity: number; unitPrice: number }>;
}

const STATUS_HI: Record<string, { label: string; cls: string }> = {
  pending_payment: { label: 'भुगतान बाकी', cls: 'bg-warning-light text-ink' },
  paid: { label: 'भुगतान हुआ', cls: 'bg-info-light text-info' },
  confirmed: { label: 'कन्फर्म', cls: 'bg-info-light text-info' },
  preparing: { label: 'तैयार हो रहा है', cls: 'bg-warning-light text-ink' },
  ready_for_pickup: { label: 'पिकअप के लिए तैयार', cls: 'bg-warning-light text-ink' },
  picked_up: { label: 'पिकअप हुआ', cls: 'bg-info-light text-info' },
  out_for_delivery: { label: 'रास्ते में', cls: 'bg-primary-light text-primary' },
  delivered: { label: 'डिलीवर हुआ', cls: 'bg-success-light text-success' },
  cancelled: { label: 'रद्द', cls: 'bg-danger-light text-danger' },
};

const ACTIVE = new Set(['confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'out_for_delivery']);

function OrderCard({ order }: { order: OrderListRow }) {
  const { addItem } = useGuestCart();
  const s = STATUS_HI[order.status] ?? { label: order.status, cls: 'bg-surface-alt text-ink-muted' };
  const summary = order.items
    .slice(0, 3)
    .map((i) => `${i.productName} ×${i.quantity}`)
    .join(', ');

  // Reorder = replay this order's lines into the guest cart → /cart.
  const reorder = () => {
    for (const it of order.items) {
      for (let n = 0; n < it.quantity; n += 1) {
        addItem({
          productId: it.productId,
          name: it.productName,
          imageUrl: null,
          pricePaise: it.unitPrice,
        });
      }
    }
  };

  return (
    <div className="rounded-xl border border-hairline bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-faint">
          #{order.id.slice(0, 8)} · {new Date(order.createdAt).toLocaleDateString('hi-IN')}
        </p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xxs font-bold ${s.cls}`}>{s.label}</span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm text-ink">
        {summary}
        {order.items.length > 3 ? ` +${order.items.length - 3} और` : ''}
      </p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-md font-bold text-ink">{formatPaise(order.totalAmount)}</span>
        <span className="flex gap-2">
          {order.status === 'delivered' && (
            <Link
              href="/cart"
              onClick={reorder}
              className="rounded-full border border-primary px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary-light"
            >
              फिर से ऑर्डर करें
            </Link>
          )}
          <Link
            href={`/order/${order.id}`}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${
              ACTIVE.has(order.status)
                ? 'bg-primary text-white'
                : 'border border-hairline text-ink-muted hover:border-primary hover:text-primary'
            }`}
          >
            {ACTIVE.has(order.status) ? 'ट्रैक करें' : 'देखें'}
          </Link>
        </span>
      </div>
    </div>
  );
}

export function OrdersClient() {
  const { data: orders, isPending } = useQuery({
    queryKey: ['my-orders'],
    queryFn: async () => (await browserApi.getMyOrders({ limit: 30 })) as unknown as OrderListRow[],
    staleTime: 15_000,
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 pb-28">
      <h1 className="mb-3 text-xl font-heavy text-ink">मेरे ऑर्डर</h1>

      {isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-surface-alt" />
          ))}
        </div>
      ) : !orders || orders.length === 0 ? (
        <div className="grid place-items-center py-20 text-center">
          <p className="text-4xl" aria-hidden>
            🧾
          </p>
          <p className="mt-2 text-sm text-ink-muted">अभी कोई ऑर्डर नहीं है</p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-dark"
          >
            खरीदारी करें
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </div>
      )}
    </div>
  );
}
