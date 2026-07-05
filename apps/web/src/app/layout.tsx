import type { Metadata, Viewport } from 'next';
import { Poppins } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers/Providers';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { BottomNav } from '@/components/layout/BottomNav';

// Brand typeface (same family as the app). Self-hosted by next/font at build
// time — no external requests, so the strict CSP (font-src 'self') holds.
// Devanagari subset is required: the storefront is Hindi-first.
const poppins = Poppins({
  subsets: ['latin', 'devanagari'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-poppins',
});

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
    <html lang="hi" className={poppins.variable}>
      <body className="min-h-full">
        {/* Reveal animations are visual-only enhancements; without JS the
            observer never fires, so un-hide everything. */}
        <noscript>
          <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
        </noscript>
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
            <BottomNav />
          </div>
        </Providers>
      </body>
    </html>
  );
}
