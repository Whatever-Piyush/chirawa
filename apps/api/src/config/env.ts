import { envSchema, type Env } from './env.schema';

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

  return result.data;
}

export const env = validateEnv();
