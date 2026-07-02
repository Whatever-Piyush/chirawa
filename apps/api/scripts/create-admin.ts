// Founder/ops admin creation — the ONLY sanctioned way to create an admin in
// production (Phase 5). The dev seed's admin (well-known phone 9999900001) is
// blocked from production by prisma/seed-guard.ts; this script promotes a REAL
// phone the founder controls. Login then works like any user: OTP over SMS
// (no dev bypass in production — otp.service gates '123456' on NODE_ENV).
//
//   pnpm --filter @chirawa/api admin:create -- --phone 98XXXXXXXX
//
// Idempotent: an existing user with that phone is promoted to admin (and
// re-activated); a missing one is created. Prints what it did. Uses the same
// dotenv loading as the API, so on the server it targets the production DB.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const phoneIdx = args.indexOf('--phone');
  const phone = phoneIdx !== -1 ? args[phoneIdx + 1] : undefined;

  if (!phone || !INDIAN_MOBILE_RE.test(phone)) {
    console.error('Usage: pnpm --filter @chirawa/api admin:create -- --phone <10-digit Indian mobile>');
    console.error('       (digits only, starts 6-9 — the founder must control this number: login is OTP to it)');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { phone } });
    const user = await prisma.user.upsert({
      where:  { phone },
      update: { role: 'admin', isActive: true },
      create: { phone, role: 'admin', isActive: true },
    });
    console.log(
      existing
        ? `✅ Existing user ${phone} promoted to admin (id ${user.id}${existing.role !== 'admin' ? `, was ${existing.role}` : ''})`
        : `✅ Admin created for ${phone} (id ${user.id})`,
    );
    console.log('   Login: OTP to this number in the app — no password/PIN exists to leak.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('❌ admin:create failed:', e);
  process.exit(1);
});
