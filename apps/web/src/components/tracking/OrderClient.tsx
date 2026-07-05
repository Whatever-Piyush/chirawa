'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderDetailResponse } from '@chirawa/types';
import { browserApi } from '@/lib/api/browser';
import { useOrderSocket } from '@/hooks/useOrderSocket';
import { StatusStepper } from '@/components/tracking/StatusStepper';
import { EtaHero, type EtaState } from '@/components/tracking/EtaHero';
import { RiderCard } from '@/components/tracking/RiderCard';
import { formatPaise } from '@/lib/format';

const TERMINAL = new Set(['delivered', 'cancelled']);
const CANCELLABLE = new Set(['pending_payment', 'paid', 'confirmed', 'preparing']);
const POLL_MS = 15_000;

interface Notice {
  id: number;
  text: string;
}

// Confirmation + live tracking (mirrors OrderTrackingScreen): socket first,
// 15s poll fallback (realtime needs backend socket CORS — plan Task 16).
export function OrderClient({ orderId, groupId }: { orderId: string; groupId: string | null }) {
  const queryClient = useQueryClient();
  const [eta, setEta] = useState<EtaState | null>(null);
  const [riderLoc, setRiderLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [live, setLive] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const [rating, setRating] = useState(0);
  const [ratingDone, setRatingDone] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    data: order,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => browserApi.getOrder(orderId),
    refetchInterval: (q) => (TERMINAL.has(q.state.data?.status ?? '') ? false : POLL_MS),
    staleTime: 0,
  });

  // Poll-derived ETA (server recomputes each fetch); socket pushes overwrite it.
  useEffect(() => {
    if (order?.eta) {
      setEta({
        secondsRemaining: order.eta.secondsRemaining,
        spreadSeconds: order.eta.spreadSeconds,
        receivedAtMs: Date.now(),
      });
    }
  }, [order?.eta?.secondsRemaining, order?.eta?.spreadSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial rider position (socket keeps it fresh afterwards).
  useEffect(() => {
    if (!order || TERMINAL.has(order.status) || !order.rider) return;
    browserApi
      .getRiderLocation(orderId)
      .then((r) => {
        if (r.location) setRiderLoc({ lat: r.location.lat, lng: r.location.lng });
      })
      .catch(() => {});
  }, [orderId, order?.rider?.phone, order?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useOrderSocket(TERMINAL.has(order?.status ?? '') ? null : orderId, {
    onConnected: setLive,
    onStatus: useCallback(
      (p: { status: string }) => {
        queryClient.setQueryData<OrderDetailResponse>(['order', orderId], (cur) =>
          cur ? { ...cur, status: p.status as OrderDetailResponse['status'] } : cur,
        );
        void refetch();
      },
      [orderId, queryClient, refetch],
    ),
    onLocation: useCallback((p: { lat: number; lng: number }) => {
      setRiderLoc({ lat: p.lat, lng: p.lng });
    }, []),
    onEta: useCallback((p: { secondsRemaining: number; spreadSeconds: number }) => {
      setEta({
        secondsRemaining: p.secondsRemaining,
        spreadSeconds: p.spreadSeconds,
        receivedAtMs: Date.now(),
      });
    }, []),
    onItemUnavailable: useCallback(
      (p: { productName: string; refundedPaise: number; cancelled: boolean; suggestion?: string }) => {
        setNotices((cur) => [
          ...cur,
          {
            id: Date.now() + cur.length,
            text: p.cancelled
              ? `'${p.productName}' उपलब्ध नहीं था — ऑर्डर रद्द, ${formatPaise(p.refundedPaise)} वापसी`
              : `'${p.productName}' उपलब्ध नहीं — ${formatPaise(p.refundedPaise)} बिल से घटा दिए गए${p.suggestion ? `। ${p.suggestion}` : ''}`,
          },
        ]);
        void refetch();
      },
      [refetch],
    ),
  });

  const cancelOrder = async () => {
    if (!window.confirm('क्या आप यह ऑर्डर रद्द करना चाहते हैं?')) return;
    setCancelling(true);
    setActionError(null);
    try {
      await browserApi.cancelOrder(orderId);
      await refetch();
    } catch {
      setActionError('रद्द नहीं हो पाया — दोबारा कोशिश करें');
    } finally {
      setCancelling(false);
    }
  };

  const submitRating = async (stars: number) => {
    setRating(stars);
    try {
      await browserApi.rateOrder(orderId, stars);
      setRatingDone(true);
    } catch {
      setActionError('रेटिंग नहीं भेज पाए — दोबारा कोशिश करें');
      setRating(0);
    }
  };

  if (isPending) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-6">
        <div className="h-56 animate-pulse rounded-xl bg-surface-alt" />
      </div>
    );
  }

  if (isError || !order) {
    return (
      <div className="mx-auto grid w-full max-w-content place-items-center px-4 py-24 text-center">
        <div>
          <p className="text-5xl" aria-hidden>
            😕
          </p>
          <h1 className="mt-4 text-xl font-heavy text-ink">ऑर्डर नहीं मिला</h1>
          <Link href="/orders" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">
            मेरे ऑर्डर देखें
          </Link>
        </div>
      </div>
    );
  }

  const codDue = order.refund?.destination === 'cash_adjustment'
    ? order.total - order.refund.amountPaise
    : order.total;
  const active = !TERMINAL.has(order.status);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 pb-28">
      {/* Confirmation header */}
      <div className="rounded-xl border border-hairline bg-surface p-4 shadow-card">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-heavy text-ink">
              {order.status === 'cancelled' ? 'ऑर्डर रद्द हुआ' : order.status === 'delivered' ? 'ऑर्डर डिलीवर हो गया ✅' : 'ऑर्डर हो गया! 🎉'}
            </h1>
            <p className="mt-0.5 text-xs text-ink-faint">
              #{order.id.slice(0, 8)} · {new Date(order.createdAt).toLocaleString('hi-IN')}
            </p>
          </div>
          {active && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xxs font-bold ${
                live ? 'bg-success-light text-success' : 'bg-surface-alt text-ink-faint'
              }`}
            >
              {live ? '● लाइव' : '↻ हर 15s'}
            </span>
          )}
        </div>

        {order.status !== 'cancelled' && (
          <p className="mt-2 rounded-lg bg-primary-light/60 px-3 py-2 text-sm font-semibold text-ink">
            💵 डिलीवरी पर {formatPaise(codDue)} नकद देने हैं
            {order.refund?.destination === 'cash_adjustment' && (
              <span className="block text-xs font-medium text-ink-muted">
                ({formatPaise(order.refund.amountPaise)} की वापसी बिल में घटा दी गई है)
              </span>
            )}
          </p>
        )}
      </div>

      {/* Status */}
      <div className="mt-4 rounded-xl border border-hairline bg-surface p-4 shadow-card">
        {order.status === 'cancelled' ? (
          <p className="rounded-lg bg-danger-light px-3 py-2 text-sm font-semibold text-danger">
            यह ऑर्डर रद्द कर दिया गया है।
          </p>
        ) : (
          <StatusStepper status={order.status} />
        )}

        {active && eta && order.status !== 'cancelled' && (
          <div className="mt-4">
            <EtaHero eta={eta} />
          </div>
        )}
      </div>

      {notices.length > 0 && (
        <div className="mt-4 space-y-2">
          {notices.map((n) => (
            <p key={n.id} className="rounded-lg bg-warning-light px-3 py-2 text-sm font-semibold text-ink">
              ⚠️ {n.text}
            </p>
          ))}
        </div>
      )}

      {order.rider && active && (
        <div className="mt-4">
          <RiderCard rider={order.rider} location={riderLoc} />
        </div>
      )}

      {/* Rating on delivered */}
      {order.status === 'delivered' && (
        <div className="mt-4 rounded-xl border border-hairline bg-surface p-4 text-center shadow-card">
          {ratingDone ? (
            <p className="text-sm font-semibold text-success">धन्यवाद! आपकी रेटिंग मिल गई 🙏</p>
          ) : (
            <>
              <p className="text-sm font-bold text-ink">ऑर्डर कैसा रहा?</p>
              <div className="mt-2 flex justify-center gap-1.5">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void submitRating(s)}
                    aria-label={`${s} स्टार`}
                    className={`text-2xl transition-transform hover:scale-110 ${s <= rating ? '' : 'grayscale opacity-50'}`}
                  >
                    ⭐
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Items + bill */}
      <div className="mt-4 rounded-xl border border-hairline bg-surface p-4 shadow-card">
        <h2 className="text-md font-bold text-ink">आपका सामान</h2>
        <div className="mt-1">
          {order.items.map((it) => (
            <div key={it.productId} className="flex items-center justify-between gap-3 border-b border-divider py-2 last:border-b-0">
              <span className="min-w-0 flex-1 text-sm text-ink">
                {it.productName} <span className="text-xs text-ink-muted">× {it.quantity}</span>
              </span>
              <span className="text-sm font-semibold text-ink">{formatPaise(it.subtotal)}</span>
            </div>
          ))}
        </div>
        <dl className="mt-2 space-y-1 border-t border-divider pt-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-muted">उप-कुल</dt>
            <dd className="text-ink">{formatPaise(order.cartSubtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">डिलीवरी शुल्क</dt>
            <dd className={order.deliveryFee === 0 ? 'font-semibold text-success' : 'text-ink'}>
              {order.deliveryFee === 0 ? 'मुफ्त' : formatPaise(order.deliveryFee)}
            </dd>
          </div>
          {order.discount > 0 && (
            <div className="flex justify-between text-success">
              <dt>छूट</dt>
              <dd>−{formatPaise(order.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-divider pt-1.5 text-md font-bold text-ink">
            <dt>कुल</dt>
            <dd>{formatPaise(order.total)}</dd>
          </div>
        </dl>
      </div>

      {/* Address */}
      <div className="mt-4 rounded-xl border border-hairline bg-surface p-4 shadow-card">
        <h2 className="text-md font-bold text-ink">डिलीवरी पता</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          📍 {[order.deliveryAddress.street, order.deliveryAddress.landmark !== '-' ? order.deliveryAddress.landmark : null, order.deliveryAddress.locality, order.deliveryAddress.pincode].filter(Boolean).join(', ')}
        </p>
      </div>

      {groupId && <GroupSummary groupId={groupId} currentOrderId={order.id} />}

      {actionError && (
        <p className="mt-4 rounded-lg bg-danger-light px-3 py-2 text-sm font-semibold text-danger">{actionError}</p>
      )}

      {CANCELLABLE.has(order.status) && (
        <button
          type="button"
          onClick={() => void cancelOrder()}
          disabled={cancelling}
          className="mt-4 h-11 w-full rounded-xl border-2 border-danger bg-surface text-sm font-bold text-danger transition-colors hover:bg-danger-light disabled:opacity-50"
        >
          {cancelling ? 'रद्द हो रहा है…' : 'ऑर्डर रद्द करें'}
        </button>
      )}

      <Link href="/" className="mt-3 block text-center text-sm font-semibold text-primary hover:underline">
        और खरीदारी करें
      </Link>
    </div>
  );
}

// Multi-shop order group: sibling orders with their own tracking pages.
function GroupSummary({ groupId, currentOrderId }: { groupId: string; currentOrderId: string }) {
  const { data: group } = useQuery({
    queryKey: ['order-group', groupId],
    queryFn: () => browserApi.getOrderGroup(groupId),
    staleTime: 30_000,
  });
  if (!group || group.orders.length <= 1) return null;

  return (
    <div className="mt-4 rounded-xl border border-hairline bg-surface p-4 shadow-card">
      <h2 className="text-md font-bold text-ink">इस ऑर्डर ग्रुप की दुकानें</h2>
      <div className="mt-1">
        {group.orders.map((o) =>
          o.id === currentOrderId ? (
            <div key={o.id} className="flex items-center justify-between border-b border-divider py-2 text-sm last:border-b-0">
              <span className="font-semibold text-ink">{o.shopName} (यह ऑर्डर)</span>
              <span className="text-ink-muted">{formatPaise(o.totalAmount)}</span>
            </div>
          ) : (
            <Link
              key={o.id}
              href={`/order/${o.id}?group=${encodeURIComponent(groupId)}`}
              className="flex items-center justify-between border-b border-divider py-2 text-sm last:border-b-0 hover:bg-surface-alt"
            >
              <span className="font-semibold text-primary">{o.shopName} →</span>
              <span className="text-ink-muted">{formatPaise(o.totalAmount)}</span>
            </Link>
          ),
        )}
      </div>
    </div>
  );
}
