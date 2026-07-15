// ─── Viewer-role PII redaction for food order detail (RC1 P1) ─────────────────
// Mirrors the marketplace's PII-window precedent (rider phone only during the
// operational window; sellers never see customer contact/address):
//
//   customer / admin → full order (it's their data / ops)
//   rider (assigned) → delivery address + receiver contact (needed to deliver
//                      and call), but NO payment identifiers or customerId
//   seller           → operational fields only: NO customer phone, street,
//                      coordinates, customerId, or payment identifiers
//
// Pure and shallow — trivially unit-testable.

const PAYMENT_FIELDS = [
  'customerId', 'razorpayOrderId', 'razorpayPaymentId', 'razorpayRefundId',
] as const;

const SELLER_HIDDEN_FIELDS = [
  'receiverPhone', 'deliveryStreet', 'deliveryLandmark', 'deliveryLat', 'deliveryLng',
] as const;

export function redactFoodOrderForViewer(
  order: Record<string, unknown>,
  role: string,
): Record<string, unknown> {
  if (role === 'customer' || role === 'admin') return order;

  const copy: Record<string, unknown> = { ...order };
  for (const key of PAYMENT_FIELDS) delete copy[key];
  if (role === 'seller') {
    for (const key of SELLER_HIDDEN_FIELDS) delete copy[key];
  }
  return copy;
}
