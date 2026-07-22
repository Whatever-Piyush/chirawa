'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { makeQueryClient } from '@/lib/query';
import { LanguageProvider } from '@/i18n/provider';
import { AuthProvider } from '@/context/AuthState';
import { LocationProvider } from '@/context/LocationContext';
import { GuestCartProvider } from '@/context/GuestCartContext';
import { LocationGate } from '@/components/location/LocationGate';
import { CartCapsule } from '@/components/cart/CartCapsule';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <AuthProvider>
          <LocationProvider>
            <GuestCartProvider>
              {children}
              {/* Global overlays */}
              <CartCapsule />
              <LocationGate />
            </GuestCartProvider>
          </LocationProvider>
        </AuthProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
