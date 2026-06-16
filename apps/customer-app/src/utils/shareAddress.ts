import { Share } from 'react-native';
import type { AddressResponse } from '@chirawa/types';

// One-line, Plus-Code-free address text for sharing.
export function formatAddressText(a: AddressResponse): string {
  return [a.street, a.landmark, a.locality, a.city, a.pincode].filter(Boolean).join(', ');
}

// Native share sheet (covers WhatsApp, SMS, etc.) — the high-class default that
// lets the user pick any app rather than locking to one.
export async function shareAddress(a: AddressResponse): Promise<void> {
  try {
    await Share.share({ message: formatAddressText(a) });
  } catch {
    /* user cancelled / unavailable — no-op */
  }
}
