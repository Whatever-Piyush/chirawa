import type { Metadata } from 'next';
import { AccountClient } from '@/components/account/AccountClient';

// Gated by middleware.
export const metadata: Metadata = {
  title: 'मेरा अकाउंट',
  robots: { index: false },
};

export default function AccountPage() {
  return <AccountClient />;
}
