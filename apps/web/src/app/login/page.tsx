import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginClient } from '@/components/auth/LoginClient';

export const metadata: Metadata = {
  title: 'लॉगिन',
  robots: { index: false },
};

export default function LoginPage() {
  // useSearchParams (next=) in the client tree requires a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <LoginClient />
    </Suspense>
  );
}
