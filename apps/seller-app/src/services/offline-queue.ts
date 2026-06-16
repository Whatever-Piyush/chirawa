import AsyncStorage from '@react-native-async-storage/async-storage';
import { SellerApi, type StockThisInput } from './api.service';

// ─── Offline-tolerant "I stock this" queue (Catalog Engine Phase 3) ───────────
// Chirawa connectivity is patchy, so a stock-this save that fails on the network
// is persisted locally and replayed later. This is safe because the server upsert
// is idempotent by (shopId, barcode) — replaying (or double-sending) just updates
// the same row. We de-dupe locally by the same key so the newest edit wins.

const KEY = 'stockThisQueue:v1';

export interface QueuedOp { id: string; input: StockThisInput; queuedAt: number }

async function readQueue(): Promise<QueuedOp[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedOp[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(q: QueuedOp[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(q));
}

// fetch() rejects with a TypeError ("Network request failed") when offline; our
// request() helper throws a plain Error(message) for real server/validation
// failures. Only the former should be queued — the latter must surface.
function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof Error && /network|timeout|failed to fetch/i.test(e.message));
}

export async function pendingCount(): Promise<number> {
  return (await readQueue()).length;
}

async function enqueue(input: StockThisInput): Promise<void> {
  const q = await readQueue();
  const id = `${input.shopId}:${input.barcode}`;
  // Latest edit wins — drop any earlier queued op for the same (shop, barcode).
  const next = q.filter((op) => op.id !== id);
  next.push({ id, input, queuedAt: Date.now() });
  await writeQueue(next);
}

/**
 * Save a stock-this now; if the network is down, queue it for later replay.
 * Returns 'synced' when it reached the server, 'queued' when stored offline.
 * Real server/validation errors are re-thrown (not queued).
 */
export async function saveStockThis(input: StockThisInput, token: string): Promise<'synced' | 'queued'> {
  try {
    await SellerApi.stockThis(input, token);
    return 'synced';
  } catch (e) {
    if (isNetworkError(e)) { await enqueue(input); return 'queued'; }
    throw e;
  }
}

/**
 * Replay queued ops. Idempotent server-side, so re-sends are harmless. Stops at
 * the first network error (still offline) and keeps the remainder; drops ops that
 * fail permanently (e.g. the shop was deleted) so they can't wedge the queue.
 */
export async function flushQueue(token: string): Promise<{ synced: number; remaining: number }> {
  let q = await readQueue();
  let synced = 0;
  for (const op of [...q]) {
    try {
      await SellerApi.stockThis(op.input, token);
      q = q.filter((x) => x.id !== op.id);
      await writeQueue(q);
      synced++;
    } catch (e) {
      if (isNetworkError(e)) break;                 // still offline — keep the rest
      q = q.filter((x) => x.id !== op.id);          // permanent failure — drop it
      await writeQueue(q);
    }
  }
  return { synced, remaining: q.length };
}
