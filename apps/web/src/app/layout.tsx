import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers/Providers';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

export const metadata: Metadata = {
  title: {
    default: 'Bringly — ताज़ा किराना, आपके दरवाज़े तक',
    template: '%s · Bringly',
  },
  description:
    'चिरावा की दुकानों से किराना और रोज़मर्रा का सामान ऑर्डर करें। डिलीवरी पर नकद भुगतान।',
  applicationName: 'Bringly',
};

export const viewport: Viewport = {
  themeColor: '#FF6B35',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Hindi-default storefront (matches the app's `language: 'hi'`).
  return (
    <html lang="hi">
      <body className="min-h-full">
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
