'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlaceOrderResponse } from '@chirawa/types';
import { browserApi } from '@/lib/api/browser';
import { useGuestCart } from '@/context/GuestCartContext';
import { replayGuestCart } from '@/lib/cartSync';
import { AddressPicker } from '@/components/checkout/AddressPicker';
import { BillSummary } from '@/components/checkout/BillSummary';
import { formatPaise } from '@/lib/format';

// COD checkout (plan §1: no payment UI of any kind). Reads the SERVER cart;
// any guest-cart lines still in localStorage are flushed into it first (tiles
// keep writing to the guest cart even when logged in — checkout entry is the
// sync point, mirroring the login replay).
export function CheckoutClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { items: guestItems, ready: guestReady, clear: clearGuestCart } = useGuestCart();

  const [synced, setSynced] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  // One idempotency key per checkout attempt-session: a double-tap or flaky
  // retry re-sends the SAME key → backend returns the original order.
  const idemKey = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`,
  );

  // Flush guest lines → server cart once on entry.
  useEffect(() => {
    if (!guestReady || synced) return;
    (async () => {
      if (guestItems.length > 0) {
        await replayGuestCart(guestItems);
        clearGuestCart();
      }
      setSynced(true);
    })().catch(() => setSynced(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestReady, synced]);

  const { data: cart, isPending: cartLoading, refetch: refetchCart } = useQuery({
    queryKey: ['server-cart'],
    queryFn: () => browserApi.getCart(),
    enabled: synced,
    staleTime: 0,
  });

  const { data: addresses } = useQuery({
    queryKey: ['addresses'],
    queryFn: () => browserApi.getAddresses(),
    enabled: synced,
    staleTime: 60_000,
  });

  // Default address preselect (first default, else first).
  useEffect(() => {
    if (!selectedAddressId && addresses && addresses.length > 0) {
      setSelectedAddressId((addresses.find((a) => a.isDefault) ?? addresses[0]!).id);
    }
  }, [addresses, selectedAddressId]);

  const canPreview = !!cart && cart.items.length > 0 && !!cart.cartId && !!selectedAddressId;
  const { data: preview, isFetching: previewLoading, refetch: refetchPreview } = useQuery({
    queryKey: ['pricing-preview', cart?.cartId, selectedAddressId, cart?.updatedAt],
    queryFn: () =>
      browserApi.getPricingPreview({ cartId: cart!.cartId, addressId: selectedAddressId! }),
    enabled: canPreview,
    staleTime: 0,
  });

  const placeOrder = async () => {
    if (!canPreview || placing) return;
    setPlacing(true);
    setError(null);
    try {
      // Raw same-origin fetch (not browserApi): the Idempotency-Key header is
      // required for double-submit protection and the api-client can't set it.
      const r = await fetch('/api/bff/orders', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idemKey.current,
        },
        body: JSON.stringify({
          cartId: cart!.cartId,
          addressId: selectedAddressId,
          paymentMethod: 'cod',
        }),
      });
      const data = (await r.json()) as PlaceOrderResponse & {
        error?: { message?: string; code?: string };
      };
      if (!r.ok) {
        // Stale pricing (fee band moved) → refresh cart + preview and let the
        // user confirm the new bill.
        if (data.error?.code === 'PRICING_REFRESH_REQUIRED' || cart?.requiresPricingRefresh) {
          await refetchCart();
          await refetchPreview();
        }
        setError(data.error?.message ?? 'ऑर्डर नहीं हो पाया — दोबारा कोशिश करें');
        return;
      }
      queryClient.removeQueries({ queryKey: ['server-cart'] });
      const suffix = data.groupId ? `?group=${encodeURIComponent(data.groupId)}` : '';
      router.replace(`/order/${data.orderId}${suffix}`);
    } catch {
      setError('ऑर्डर नहीं हो पाया — नेटवर्क जांचें और दोबारा कोशिश करें');
    } finally {
      setPlacing(false);
    }
  };

  if (!synced || cartLoading) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-6">
        <div className="h-40 animate-pulse rounded-xl bg-surface-alt" />
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto grid w-full max-w-content place-items-center px-4 py-24 text-center">
        <div>
          <p className="text-5xl" aria-hidden>
            🧺
          </p>
          <h1 className="mt-4 text-xl font-heavy text-ink">कार्ट खाली है</h1>
          <p className="mt-1 text-sm text-ink-muted">पहले कुछ सामान जोड़ें</p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-dark"
          >
            खरीदारी करें
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-content px-4 py-6 pb-28">
      <h1 className="mb-3 text-xl font-heavy text-ink">चेकआउट</h1>

      <div className="grid gap-4 md:grid-cols-[1fr,22rem] md:items-start">
        <div className="space-y-4">
          <AddressPicker
            addresses={addresses ?? []}
            selectedId={selectedAddressId}
            onSelect={setSelectedAddressId}
            onCreated={(id) => {
              setSelectedAddressId(id);
              void queryClient.invalidateQueries({ queryKey: ['addresses'] });
            }}
          />

          {/* Order summary (server cart, read-only) */}
          <section className="rounded-xl border border-hairline bg-surface p-4 shadow-card">
            <h2 className="text-md font-bold text-ink">
              आपका सामान <span className="text-sm font-medium text-ink-muted">({cart.items.length})</span>
            </h2>
            <div className="mt-1">
              {cart.items.map((it) => (
                <div
                  key={`${it.productId}::${it.variantId ?? ''}`}
                  className="flex items-center gap-3 border-b border-divider py-2.5 last:border-b-0"
                >
                  <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md border border-hairline bg-surface-alt">
                    {it.imageUrl ? (
                      <Image src={it.imageUrl} alt="" fill sizes="44px" className="object-contain p-0.5" />
                    ) : (
                      <span className="grid h-full place-items-center text-lg" aria-hidden>
                        🛍️
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-sm font-semibold text-ink">
                      {it.productName}
                      {it.variantName ? ` · ${it.variantName}` : ''}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {formatPaise(it.unitPrice)} × {it.quantity}
                    </span>
                  </span>
                  <span className="text-sm font-bold text-ink">{formatPaise(it.subtotal)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Bill + place order */}
        <div className="rounded-xl border border-hairline bg-surface p-4 shadow-card">
          <h2 className="mb-2 text-md font-bold text-ink">बिल</h2>
          {!selectedAddressId ? (
            <p className="text-sm text-ink-muted">डिलीवरी शुल्क के लिए पता चुनें</p>
          ) : preview ? (
            <BillSummary preview={preview} />
          ) : (
            <div className="h-24 animate-pulse rounded-lg bg-surface-alt" />
          )}

          {error && (
            <p className="mt-3 rounded-lg bg-danger-light px-3 py-2 text-sm font-semibold text-danger">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void placeOrder()}
            disabled={!canPreview || !preview || previewLoading || placing}
            className="tap-highlight-none mt-4 h-12 w-full rounded-xl bg-primary text-md font-bold text-white shadow-primary transition-all duration-300 ease-spring hover:bg-primary-dark hover:shadow-glow active:scale-[0.98] disabled:opacity-50"
          >
            {placing ? '⏳ ऑर्डर हो रहा है…' : `ऑर्डर करें · ${preview ? formatPaise(preview.total) : ''}`}
          </button>
          <p className="mt-2 text-center text-xs text-ink-faint">💵 डिलीवरी पर नकद भुगतान</p>
        </div>
      </div>
    </div>
  );
}
