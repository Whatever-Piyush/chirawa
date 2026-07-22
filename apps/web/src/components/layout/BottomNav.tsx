'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useGuestCart } from '@/context/GuestCartContext';

const ITEMS = [
  { href: '/', label: 'होम', icon: '🏠' },
  { href: '/search', label: 'खोजें', icon: '🔍' },
  { href: '/cart', label: 'कार्ट', icon: '🧺' },
  { href: '/orders', label: 'ऑर्डर', icon: '🧾' },
] as const;

// App-style bottom navigation (mobile only). Inactive icons are desaturated;
// the active tab gets a tinted pill — no icon set needed, stays on-brand with
// the site's emoji language.
export function BottomNav() {
  const pathname = usePathname();
  const { count, ready } = useGuestCart();

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="मुख्य नेविगेशन"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-white/90 pb-safe shadow-nav backdrop-blur-md md:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-4">
        {ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className="tap-highlight-none flex flex-col items-center gap-0.5 py-2"
            >
              <span
                className={`relative grid h-8 w-12 place-items-center rounded-full text-lg transition-all duration-300 ease-spring ${
                  active ? 'bg-primary-light' : '[filter:grayscale(1)opacity(0.55)]'
                }`}
                aria-hidden
              >
                {item.icon}
                {item.href === '/cart' && ready && count > 0 && (
                  <span className="absolute -right-0.5 -top-1 grid h-4 min-w-4 animate-pop place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </span>
              <span
                className={`text-xxs font-semibold ${active ? 'text-primary' : 'text-ink-faint'}`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
