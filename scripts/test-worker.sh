#!/bin/bash
echo "🔧 Triggering worker jobs manually..."
cd apps/api

npx tsx --tsconfig tsconfig.json << 'SCRIPT'
import Redis from 'ioredis';
import { Queue } from 'bullmq';

async function main() {
  const conn = new Redis('redis://:chirawa_redis_dev_password@localhost:6379', {
    maxRetriesPerRequest: null, enableReadyCheck: false
  });
  const settlement     = new Queue('chirawa-settlement',     { connection: conn });
  const reconciliation = new Queue('chirawa-reconciliation', { connection: conn });
  const cleanup        = new Queue('chirawa-cleanup',        { connection: conn });

  await settlement.add('daily-settlement',   {});
  await reconciliation.add('payment-reconcile', {});
  await cleanup.add('location-cleanup', { type: 'location' });
  await cleanup.add('otp-cleanup',      { type: 'otp' });

  console.log('✅ All jobs queued — check worker terminal for results');
  await settlement.close(); await reconciliation.close(); await cleanup.close();
  await conn.quit();
}

main().catch(console.error);
SCRIPT
