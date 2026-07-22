'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/context/AuthState';
import { useLanguage } from '@/i18n/provider';

export function AccountClient() {
  const router = useRouter();
  const { session, logout } = useAuth();
  const { language, setLanguage } = useLanguage();
  const [loggingOut, setLoggingOut] = useState(false);

  const doLogout = async () => {
    setLoggingOut(true);
    await logout();
    router.replace('/');
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 pb-28">
      <h1 className="mb-3 text-xl font-heavy text-ink">मेरा अकाउंट</h1>

      <div className="rounded-xl border border-hairline bg-surface p-4 shadow-card">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-light text-2xl" aria-hidden>
            👤
          </span>
          <span>
            <span className="block text-sm font-bold text-ink">Bringly ग्राहक</span>
            <span className="block text-xs text-ink-muted">
              {session.authed ? 'लॉगिन है' : 'लॉगिन नहीं'}
            </span>
          </span>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-hairline bg-surface shadow-card">
        <Link href="/orders" className="flex items-center justify-between border-b border-divider px-4 py-3.5 hover:bg-surface-alt">
          <span className="text-sm font-semibold text-ink">🧾 मेरे ऑर्डर</span>
          <span className="text-ink-faint" aria-hidden>›</span>
        </Link>
        <Link href="/account/addresses" className="flex items-center justify-between border-b border-divider px-4 py-3.5 hover:bg-surface-alt">
          <span className="text-sm font-semibold text-ink">📍 मेरे पते</span>
          <span className="text-ink-faint" aria-hidden>›</span>
        </Link>
        <div className="flex items-center justify-between px-4 py-3.5">
          <span className="text-sm font-semibold text-ink">🌐 भाषा / Language</span>
          <span className="flex gap-1 rounded-full border border-hairline p-0.5">
            <button
              type="button"
              onClick={() => setLanguage('hi')}
              className={`rounded-full px-3 py-1 text-xs font-bold ${language === 'hi' ? 'bg-primary text-white' : 'text-ink-muted'}`}
            >
              हिं
            </button>
            <button
              type="button"
              onClick={() => setLanguage('en')}
              className={`rounded-full px-3 py-1 text-xs font-bold ${language === 'en' ? 'bg-primary text-white' : 'text-ink-muted'}`}
            >
              EN
            </button>
          </span>
        </div>
      </div>

      <a
        href="https://wa.me/"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-success bg-success-light py-3 text-sm font-bold text-success"
      >
        💬 मदद चाहिए? WhatsApp करें
      </a>

      <button
        type="button"
        onClick={() => void doLogout()}
        disabled={loggingOut}
        className="mt-4 h-11 w-full rounded-xl border-2 border-danger bg-surface text-sm font-bold text-danger transition-colors hover:bg-danger-light disabled:opacity-50"
      >
        {loggingOut ? 'लॉगआउट हो रहा है…' : 'लॉगआउट'}
      </button>
    </div>
  );
}
