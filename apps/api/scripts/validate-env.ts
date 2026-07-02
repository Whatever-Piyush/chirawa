// Environment preflight (Production Hardening Phase 2, task 6).
//
// Validates the environment the API/worker would boot with — same schema, same
// dotenv loading — WITHOUT starting anything. The release script runs this on
// the server (as NODE_ENV=production) BEFORE migrating or reloading PM2, so a
// bad .env fails the deploy while the old release keeps serving traffic.
//
//   pnpm --filter @chirawa/api env:check                    # local, uses apps/api/.env
//   NODE_ENV=production pnpm --filter @chirawa/api env:check # what the release runs
//
// Exit codes: 0 = valid (warnings allowed — they are designed degradations),
//             1 = invalid, do not deploy/boot.
import 'dotenv/config';
import { envSchema, collectProductionWarnings } from '../src/config/env.schema';

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('❌ Environment INVALID — the API would refuse to boot:\n');
  const errors = result.error.flatten().fieldErrors;
  Object.entries(errors).forEach(([key, messages]) => {
    console.error(`  ${key}: ${messages?.join(', ')}`);
  });
  console.error('\nFix these before deploying. Reference: .env.example (repo root).');
  process.exit(1);
}

const env = result.data;
const warnings = env.NODE_ENV === 'production' ? collectProductionWarnings(env) : [];
for (const warning of warnings) {
  console.warn(`⚠️  ${warning}`);
}

console.log(
  `✅ Environment valid (NODE_ENV=${env.NODE_ENV})` +
    (warnings.length > 0 ? ` — ${warnings.length} degraded-service warning(s) above` : ''),
);
