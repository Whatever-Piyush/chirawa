'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { makeQueryClient } from '@/lib/query';
import { LanguageProvider } from '@/i18n/provider';
import { LocationProvider } from '@/context/LocationContext';
import { GuestCartProvider } from '@/context/GuestCartContext';
import { LocationGate } from '@/components/location/LocationGate';
import { CartCapsule } from '@/components/cart/CartCapsule';

// Client-side provider shell. Task 11 nests AuthState inside here.
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <LocationProvider>
          <GuestCartProvider>
            {children}
            {/* Global overlays */}
            <CartCapsule />
            <LocationGate />
          </GuestCartProvider>
        </LocationProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
