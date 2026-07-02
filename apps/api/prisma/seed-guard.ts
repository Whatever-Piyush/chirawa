// Production guard for dev seeds (Phase 5). The seeds create users with
// WELL-KNOWN phone numbers (founder admin 9999900001, riders 77001100xx) that
// anyone reading this public-ish repo could OTP-login as — running them against
// the production database would be an account-takeover kit, plus demo shops/
// products/promos appearing in the live catalog.
//
// dotenv/config is loaded HERE so the check sees the same .env the API boots
// with: on the server /opt/chirawa/apps/api/.env carries NODE_ENV=production
// even when a manual shell doesn't export it (the server's DATABASE_URL is
// localhost, so NODE_ENV — explicit-required since Phase 2 — is the reliable
// signal there; the URL heuristic additionally catches remote-DB mistakes
// from a dev machine).
import 'dotenv/config';

const LOCAL_DB_RE = /localhost|127\.0\.0\.1|@postgres:|@db:/i;

export function assertSeedableEnvironment(seedName: string): void {
  if (process.env.SEED_FORCE === 'i-know-this-adds-demo-accounts') {
    console.warn(`⚠️  [${seedName}] SEED_FORCE override — seeding despite production signals`);
    return;
  }

  const problems: string[] = [];
  if (process.env.NODE_ENV === 'production') {
    problems.push('NODE_ENV=production');
  }
  const dbUrl = process.env.DATABASE_URL ?? '';
  if (dbUrl && !LOCAL_DB_RE.test(dbUrl)) {
    problems.push('DATABASE_URL does not look local');
  }

  if (problems.length > 0) {
    console.error(`\n❌ [${seedName}] REFUSING to seed: ${problems.join(' + ')}.`);
    console.error('   Dev seeds create demo accounts with well-known phone numbers —');
    console.error('   never run them against production. Founder admin creation has a');
    console.error('   dedicated safe path: pnpm --filter @chirawa/api admin:create -- --phone <number>');
    console.error('   (If you REALLY mean it: SEED_FORCE=i-know-this-adds-demo-accounts)\n');
    process.exit(1);
  }
}
