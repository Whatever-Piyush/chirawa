'use client';

import { useRef } from 'react';

// 6-digit OTP entry: one real (invisible) input over rendered boxes — paste,
// backspace and mobile keyboards all just work; no per-box focus juggling.
export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const digits = value.padEnd(length).slice(0, length).split('');
  const activeIndex = Math.min(value.length, length - 1);

  return (
    <div
      className="relative"
      onClick={() => inputRef.current?.focus()}
      role="group"
      aria-label="OTP"
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d*"
        maxLength={length}
        disabled={disabled}
        aria-label="OTP कोड"
        className="absolute inset-0 z-10 h-full w-full opacity-0"
      />
      <div className="flex justify-between gap-2">
        {digits.map((d, i) => (
          <div
            key={i}
            className={`grid h-12 w-11 place-items-center rounded-xl border-2 bg-surface text-xl font-bold text-ink ${
              i === activeIndex && !disabled ? 'border-primary' : 'border-hairline'
            }`}
          >
            {d.trim()}
          </div>
        ))}
      </div>
    </div>
  );
}
