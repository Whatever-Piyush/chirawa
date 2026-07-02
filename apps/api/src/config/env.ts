import { envSchema, collectProductionWarnings, type Env } from './env.schema';

export type { Env };

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('\n❌ Invalid environment variables:\n');
    const errors = result.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  ${key}: ${messages?.join(', ')}`);
    });
    console.error('\nFix these in apps/api/.env then restart.\n');
    process.exit(1);
  }

  // Degraded-but-bootable config: warn on every boot so it can't be forgotten.
  if (result.data.NODE_ENV === 'production') {
    for (const warning of collectProductionWarnings(result.data)) {
      console.warn(`⚠️  [env] ${warning}`);
    }
  }

  return result.data;
}

export const env = validateEnv();
