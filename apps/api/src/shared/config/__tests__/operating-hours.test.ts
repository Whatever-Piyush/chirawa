import { describe, it, expect } from 'vitest';
import { currentISTHour, currentISTTimeHHMM, isWithinOperatingHours } from '../operating-hours';
import { computeIsOpen } from '../../../modules/catalog/catalog.service';

// P1-4 regression tests. Every case uses a FIXED UTC instant with a known IST
// equivalent (IST = UTC+5:30, no DST), so they pass identically on a laptop in
// IST and on the UTC production host — the exact divergence that caused the bug.

const utc = (h: number, m = 0) => new Date(Date.UTC(2026, 6, 15, h, m)); // 2026-07-15

describe('currentISTTimeHHMM', () => {
  it('converts UTC to IST wall-clock (+5:30)', () => {
    expect(currentISTTimeHHMM(utc(5, 0))).toBe('10:30');
    expect(currentISTTimeHHMM(utc(12, 45))).toBe('18:15');
  });

  it('handles the IST midnight edge as 00:xx, never 24:xx', () => {
    expect(currentISTTimeHHMM(utc(18, 30))).toBe('00:00'); // 18:30 UTC = 00:00 IST
    expect(currentISTTimeHHMM(utc(18, 45))).toBe('00:15');
  });
});

describe('computeIsOpen (shop badge — the P1-4 path)', () => {
  const shop = { isOpen: true, openTime: '09:00', closeTime: '20:00' };

  it('is open mid-business-day IST even when the server clock is UTC morning', () => {
    // 05:00 UTC = 10:30 IST → open. Under the old Date#getHours() logic a UTC
    // server compared "05:00" < "09:00" and showed every shop closed all morning.
    expect(computeIsOpen(shop, utc(5, 0))).toBe(true);
  });

  it('is closed after IST closing time even when UTC still reads mid-afternoon', () => {
    // 15:00 UTC = 20:30 IST → closed. Old logic: "15:00" ≤ "20:00" → wrongly open.
    expect(computeIsOpen(shop, utc(15, 0))).toBe(false);
  });

  it('respects the boundaries inclusively at open and close', () => {
    expect(computeIsOpen(shop, utc(3, 30))).toBe(true);  // 09:00 IST exactly
    expect(computeIsOpen(shop, utc(14, 30))).toBe(true); // 20:00 IST exactly
    expect(computeIsOpen(shop, utc(3, 29))).toBe(false); // 08:59 IST
  });

  it('is closed whenever the seller toggled the shop off, regardless of hours', () => {
    expect(computeIsOpen({ ...shop, isOpen: false }, utc(5, 0))).toBe(false);
  });
});

describe('existing IST helpers stay consistent (sanity)', () => {
  it('currentISTHour matches the HH of currentISTTimeHHMM', () => {
    for (const d of [utc(5, 0), utc(18, 30), utc(23, 59)]) {
      expect(String(currentISTHour(d)).padStart(2, '0')).toBe(currentISTTimeHHMM(d).slice(0, 2));
    }
  });

  it('checkout window agrees with the badge at the 8 PM IST cutoff', () => {
    // 14:29 UTC = 19:59 IST → orderable; 14:30 UTC = 20:00 IST → not orderable.
    expect(isWithinOperatingHours(utc(14, 29))).toBe(true);
    expect(isWithinOperatingHours(utc(14, 30))).toBe(false);
  });
});

describe('OPERATING_HOURS_DISABLED override (load-test harness, Phase 6)', () => {
  const closedMoment = () => {
    // 14:30 UTC = 20:00 IST — normally not orderable.
    const d = new Date();
    d.setUTCHours(14, 30, 0, 0);
    return d;
  };

  it('opens the window outside production when set', () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    process.env.OPERATING_HOURS_DISABLED = 'true';
    try {
      expect(isWithinOperatingHours(closedMoment())).toBe(true);
    } finally {
      delete process.env.OPERATING_HOURS_DISABLED;
      process.env.NODE_ENV = prevEnv;
    }
  });

  it('is IGNORED in production — the gate cannot be disabled there', () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.OPERATING_HOURS_DISABLED = 'true';
    try {
      expect(isWithinOperatingHours(closedMoment())).toBe(false);
    } finally {
      delete process.env.OPERATING_HOURS_DISABLED;
      process.env.NODE_ENV = prevEnv;
    }
  });
});
