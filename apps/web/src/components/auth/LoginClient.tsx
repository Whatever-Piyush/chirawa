'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError } from '@chirawa/api-client';
import { browserApi } from '@/lib/api/browser';
import { useAuth } from '@/context/AuthState';
import { useGuestCart } from '@/context/GuestCartContext';
import { replayGuestCart } from '@/lib/cartSync';
import { OtpInput } from '@/components/ui/OtpInput';

const PHONE_RE = /^[6-9]\d{9}$/;
const RESEND_COOLDOWN_S = 30;

// Only same-site relative paths may be a post-login target (open-redirect guard).
function safeNext(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/';
}

export function LoginClient() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const { session, ready, refresh } = useAuth();
  const { items: guestItems, clear: clearGuestCart } = useGuestCart();

  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  // Already logged in (e.g. back button) → straight to the target.
  useEffect(() => {
    if (ready && session.authed) router.replace(next);
  }, [ready, session.authed, router, next]);

  // Resend cooldown tick.
  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => setResendIn((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [resendIn > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendOtp = async () => {
    if (!PHONE_RE.test(phone)) {
      setError('सही 10-अंकी मोबाइल नंबर डालें');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await browserApi.sendOtp({ phone });
      setStep('otp');
      setOtp('');
      setResendIn(RESEND_COOLDOWN_S);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'OTP नहीं भेजा जा सका — दोबारा कोशिश करें');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      // The cookie-minting Next route — NOT the raw backend endpoint.
      const r = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, otp: code }),
      });
      const data = (await r.json()) as { error?: { message?: string } };
      if (!r.ok) {
        setOtp('');
        setError(data.error?.message ?? 'गलत OTP है');
        return;
      }

      // Session first (BFF now authed), then replay the guest cart into the
      // server cart and clear local — server cart is the source of truth.
      await refresh();
      if (guestItems.length > 0) {
        await replayGuestCart(guestItems);
        clearGuestCart();
      }
      router.replace(next);
    } catch {
      setError('लॉगिन नहीं हो पाया — दोबारा कोशिश करें');
    } finally {
      setBusy(false);
    }
  };

  // Auto-verify when the 6th digit lands.
  const autoRef = useRef(false);
  useEffect(() => {
    if (step === 'otp' && otp.length === 6 && !busy && !autoRef.current) {
      autoRef.current = true;
      void verify(otp).finally(() => {
        autoRef.current = false;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, step]);

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 pb-28">
      <div className="animate-fade-up rounded-[1.5rem] border border-hairline bg-surface p-6 shadow-lift">
        <p className="inline-grid h-14 w-14 animate-float place-items-center rounded-2xl bg-primary-light text-3xl" aria-hidden>
          🛵
        </p>
        <h1 className="mt-3 text-xl font-heavy tracking-tight text-ink">Bringly में आपका स्वागत है</h1>
        <p className="mt-0.5 text-sm text-ink-muted">मिनटों में किराना, आपके दरवाज़े तक</p>

        {step === 'phone' ? (
          <form
            className="mt-5"
            onSubmit={(e) => {
              e.preventDefault();
              void sendOtp();
            }}
          >
            <label className="text-sm font-semibold text-ink" htmlFor="phone">
              अपना मोबाइल नंबर डालें
            </label>
            <div className="mt-2 flex items-center gap-2 rounded-xl border-2 border-hairline bg-surface px-3 py-2.5 focus-within:border-primary">
              <span className="text-md font-semibold text-ink-muted">+91</span>
              <input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                inputMode="numeric"
                autoComplete="tel-national"
                autoFocus
                placeholder="मोबाइल नंबर"
                className="min-w-0 flex-1 bg-transparent text-md font-semibold tracking-wide text-ink outline-none placeholder:font-normal placeholder:text-ink-faint"
              />
            </div>

            <button
              type="submit"
              disabled={busy || phone.length !== 10}
              className="mt-4 h-12 w-full rounded-xl bg-primary text-md font-bold text-white shadow-primary transition-colors hover:bg-primary-dark disabled:opacity-50"
            >
              {busy ? 'भेज रहे हैं…' : 'OTP भेजें'}
            </button>
          </form>
        ) : (
          <div className="mt-5">
            <p className="text-sm text-ink-muted">
              6-अंकी OTP कोड डालें — <span className="font-semibold text-ink">+91 {phone}</span>
            </p>
            <button
              type="button"
              className="mt-1 text-xs font-semibold text-primary hover:underline"
              onClick={() => {
                setStep('phone');
                setOtp('');
                setError(null);
              }}
            >
              नंबर बदलें?
            </button>

            <div className="mt-4">
              <OtpInput value={otp} onChange={setOtp} disabled={busy} />
            </div>

            <button
              type="button"
              disabled={busy || otp.length !== 6}
              onClick={() => void verify(otp)}
              className="mt-4 h-12 w-full rounded-xl bg-primary text-md font-bold text-white shadow-primary transition-colors hover:bg-primary-dark disabled:opacity-50"
            >
              {busy ? 'जाँच रहे हैं…' : 'OTP सत्यापित करें'}
            </button>

            <button
              type="button"
              disabled={busy || resendIn > 0}
              onClick={() => void sendOtp()}
              className="mt-3 w-full text-center text-sm font-semibold text-primary disabled:text-ink-faint"
            >
              {resendIn > 0 ? `OTP दोबारा भेजें (${resendIn}s)` : 'OTP दोबारा भेजें'}
            </button>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg bg-danger-light px-3 py-2 text-sm font-semibold text-danger">
            {error}
          </p>
        )}

        <p className="mt-5 text-xs leading-relaxed text-ink-faint">
          लॉगिन करके आप हमारी शर्तें और प्राइवेसी पॉलिसी से सहमत होते हैं
        </p>
      </div>
    </div>
  );
}
