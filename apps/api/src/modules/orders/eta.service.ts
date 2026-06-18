import type { PrismaClient } from '@prisma/client';
import { emitOrderEtaChanged } from '../../shared/events/event-bus';
import { haversineMeters } from '../../shared/utils/geo';

// ── ETA MVP Phase 1 — milestone ETA (no live/ping recompute, no provider calls) ──
// ETA = prep_remaining + travel + dwell + handover, recomputed at each phase
// transition. The shop→customer travel leg is derived from the coordinates the order
// already stores (Shop.lat/lng + Order.deliveryLat/lng) via Haversine × a road-factor —
// NOT from the billing field Order.distanceKm, which is 0 on the flat-fee path
// (P1 hardening, finding #6). So this still makes ZERO map-provider calls. The fallback
// wide range applies only when coordinates are missing (review F1).
//
// Tunables are conservative for a dense ~3 km town (review A2: real two-wheeler speed
// through market lanes is well under 20 km/h). They move to AppConfig in a later phase.
const TOWN_SPEED_KMPH     = 14;
const ROAD_FACTOR         = 1.3;  // straight-line → approx road distance (P1; calibrate in P3)
const PICKUP_DWELL_MIN    = 3;    // parking/waiting at the shop (review A1)
const HANDOVER_MIN        = 2;    // finding the door + handover at the drop (review A1)
const ETA_FLOOR_MIN       = 5;    // never promise less (review E2)
const FALLBACK_TRAVEL_MIN = 12;   // used only when the leg is unknown (coords missing)
const SPREAD_PENDING_SEC  = 300;  // ±5 min before pickup
const SPREAD_ACTIVE_SEC   = 120;  // ±2 min once out for delivery
const SPREAD_FALLBACK_SEC = 600;  // ±10 min when distance is unknown (review F1)

const TERMINAL    = new Set(['delivered', 'cancelled']);
const PREP_DONE   = new Set(['ready_for_pickup', 'picked_up', 'out_for_delivery']);
const POST_PICKUP = new Set(['picked_up', 'out_for_delivery']);

export interface EtaInputs {
  status:           string;
  sellerAcceptedAt: Date | null;
  preparingAt:      Date | null;
  legKm:            number | null;  // shop→customer travel leg (km); null → coords missing
  prepTimeMinutes:  number;
  now?:             Date;
}

export interface EtaResult {
  estimatedDeliveryAt: Date;
  etaSpreadSeconds:    number;
  etaSource:           'prep_road' | 'fallback';
}

// Pure: compute the ETA for a single order from its current phase. Returns null for
// terminal states (no ETA). No I/O — unit-tested directly.
export function computeEta(input: EtaInputs): EtaResult | null {
  if (TERMINAL.has(input.status)) return null;
  const now = input.now ?? new Date();

  // prep remaining — 0 once ready/picked up; otherwise full prep minus elapsed,
  // anchored on when the seller actually started (review A3), not on confirmation.
  let prepRemainingMin = 0;
  if (!PREP_DONE.has(input.status)) {
    const anchor     = input.preparingAt ?? input.sellerAcceptedAt;
    const elapsedMin = anchor ? Math.max(0, (now.getTime() - anchor.getTime()) / 60_000) : 0;
    prepRemainingMin = Math.max(0, input.prepTimeMinutes - elapsedMin);
  }

  // A leg of 0 (customer at the shop) is VALID, not "unknown" — only a missing/NaN leg
  // (coords absent) falls back to the wide range (fixes review #6's "> 0 misclassifies 0").
  const hasLeg    = input.legKm != null && Number.isFinite(input.legKm) && input.legKm >= 0;
  const travelMin = hasLeg ? (input.legKm! / TOWN_SPEED_KMPH) * 60 : FALLBACK_TRAVEL_MIN;
  const dwellMin  = (POST_PICKUP.has(input.status) ? 0 : PICKUP_DWELL_MIN) + HANDOVER_MIN;

  const totalMin = Math.max(ETA_FLOOR_MIN, prepRemainingMin + travelMin + dwellMin);
  const estimatedDeliveryAt = new Date(now.getTime() + totalMin * 60_000);

  const etaSpreadSeconds = !hasLeg
    ? SPREAD_FALLBACK_SEC
    : POST_PICKUP.has(input.status) ? SPREAD_ACTIVE_SEC : SPREAD_PENDING_SEC;

  return { estimatedDeliveryAt, etaSpreadSeconds, etaSource: hasLeg ? 'prep_road' : 'fallback' };
}

// Load → compute → persist → broadcast `order:eta`. Best-effort: NEVER throws to the
// caller (ETA must not break order flow — same discipline as the BUG-2 rider lookup).
export async function computeAndPersistEta(prisma: PrismaClient, orderId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where:  { id: orderId },
      select: {
        status: true, customerId: true, sellerAcceptedAt: true, preparingAt: true,
        deliveryLat: true, deliveryLng: true,
        shop: { select: { prepTimeMinutes: true, lat: true, lng: true } },
      },
    });
    if (!order || TERMINAL.has(order.status)) return; // terminal: leave any stale value; getOrder gates display

    // Shop→customer travel leg from stored coordinates (P1 #6) — Haversine × road-factor,
    // no provider call. null only if a coordinate is somehow missing → wide fallback.
    const sLat = Number(order.shop.lat), sLng = Number(order.shop.lng);
    const dLat = Number(order.deliveryLat), dLng = Number(order.deliveryLng);
    const coordsOk = [sLat, sLng, dLat, dLng].every(Number.isFinite);
    const legKm = coordsOk
      ? (haversineMeters({ lat: sLat, lng: sLng }, { lat: dLat, lng: dLng }) / 1000) * ROAD_FACTOR
      : null;

    const result = computeEta({
      status:           order.status,
      sellerAcceptedAt: order.sellerAcceptedAt,
      preparingAt:      order.preparingAt,
      legKm,
      prepTimeMinutes:  order.shop.prepTimeMinutes,
    });
    if (!result) return;

    await prisma.order.update({
      where: { id: orderId },
      data: {
        estimatedDeliveryAt: result.estimatedDeliveryAt,
        etaSpreadSeconds:    result.etaSpreadSeconds,
        etaComputedAt:       new Date(),
        etaSource:           result.etaSource,
      },
    });

    emitOrderEtaChanged({
      orderId,
      customerId:          order.customerId,
      estimatedDeliveryAt: result.estimatedDeliveryAt.toISOString(),
      etaSpreadSeconds:    result.etaSpreadSeconds,
      status:              order.status,
      source:              result.etaSource,
    });
  } catch {
    /* best-effort: ETA computation must never break order flow */
  }
}

// Build the client-facing `eta` block for GET /orders/:id from a persisted order.
// Returns undefined (→ omitted from the response) for terminal/unset orders. Sends a
// duration + serverNow, not a bare absolute timestamp (review F3: client clock skew).
export function etaResponse(order: {
  status: string;
  estimatedDeliveryAt: Date | null;
  etaSpreadSeconds: number | null;
  etaSource: string | null;
}): { secondsRemaining: number; spreadSeconds: number; serverNow: string; source: string } | undefined {
  if (!order.estimatedDeliveryAt || TERMINAL.has(order.status)) return undefined;
  const now = Date.now();
  return {
    secondsRemaining: Math.max(0, Math.round((order.estimatedDeliveryAt.getTime() - now) / 1000)),
    spreadSeconds:    order.etaSpreadSeconds ?? SPREAD_PENDING_SEC,
    serverNow:        new Date(now).toISOString(),
    source:           order.etaSource ?? 'prep_road',
  };
}
