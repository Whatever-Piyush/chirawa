import { describe, it, expect } from 'vitest';
import { redactFoodOrderForViewer } from '../food-redact';

// RC1 P1 — viewer-role PII window for food order detail. Sellers must never
// see customer contact/address/payment ids; riders keep delivery fields but
// never payment ids; customers/admin see everything.

const FULL_ORDER = {
  id: 'order-1',
  status: 'confirmed',
  customerId: 'cust-1',
  totalPaise: 25_900,
  deliveryStreet: '12 Gali No 4',
  deliveryLandmark: 'Near mandir',
  deliveryLocality: 'Ward 8',
  deliveryLat: '28.24',
  deliveryLng: '75.64',
  receiverName: 'Aditya',
  receiverPhone: '9876543210',
  razorpayOrderId: 'order_rzp1',
  razorpayPaymentId: 'pay_rzp1',
  razorpayRefundId: null,
  items: [{ name: 'Margherita Pizza', quantity: 1 }],
};

describe('redactFoodOrderForViewer', () => {
  it('customer sees the full order (their own data)', () => {
    expect(redactFoodOrderForViewer(FULL_ORDER, 'customer')).toEqual(FULL_ORDER);
  });

  it('admin sees the full order (ops)', () => {
    expect(redactFoodOrderForViewer(FULL_ORDER, 'admin')).toEqual(FULL_ORDER);
  });

  it('seller loses customer contact, address, coordinates, and payment ids', () => {
    const seller = redactFoodOrderForViewer(FULL_ORDER, 'seller');
    for (const hidden of [
      'receiverPhone', 'deliveryStreet', 'deliveryLandmark', 'deliveryLat', 'deliveryLng',
      'customerId', 'razorpayOrderId', 'razorpayPaymentId', 'razorpayRefundId',
    ]) {
      expect(seller).not.toHaveProperty(hidden);
    }
    // Operational fields survive.
    expect(seller['deliveryLocality']).toBe('Ward 8');
    expect(seller['receiverName']).toBe('Aditya');
    expect(seller['totalPaise']).toBe(25_900);
    expect(seller['items']).toEqual(FULL_ORDER.items);
  });

  it('rider keeps delivery address + receiver contact but loses payment ids', () => {
    const rider = redactFoodOrderForViewer(FULL_ORDER, 'rider');
    expect(rider['deliveryStreet']).toBe('12 Gali No 4');
    expect(rider['receiverPhone']).toBe('9876543210');
    for (const hidden of ['customerId', 'razorpayOrderId', 'razorpayPaymentId', 'razorpayRefundId']) {
      expect(rider).not.toHaveProperty(hidden);
    }
  });

  it('never mutates the input (shallow copy)', () => {
    const before = { ...FULL_ORDER };
    redactFoodOrderForViewer(FULL_ORDER, 'seller');
    expect(FULL_ORDER).toEqual(before);
  });
});
