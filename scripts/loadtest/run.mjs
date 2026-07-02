// Phase 6 load-test orchestrator. Boots the COMPILED API + worker against the
// local Postgres/Redis (same engines as production), provisions test identities
// through the real auth flow, then drives six scenarios and writes a JSON
// evidence file per run. See README.md; interpretation lives in
// docs/PERFORMANCE_REPORT.md.
//
//   node scripts/loadtest/run.mjs [--scenario=all|browse|search|checkout|orders|sockets]
//                                 [--duration=30] [--users=60]
//
// Requires: apps/api built (pnpm --filter @chirawa/api build), DB seeded,
// docker-compose PG+Redis up. Runs are NON-production by construction — the
// enabler env vars below are ignored in production builds.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClosedLoop, timedJson, percentiles } from './lib/loadgen.mjs';
import { Sampler } from './lib/sampler.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_DIR = path.join(ROOT, 'apps/api');
const RESULTS_DIR = path.join(ROOT, 'scripts/loadtest/results');

// ── CLI ───────────────────────────────────────────────────────────────────────
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const SCENARIO = arg('scenario', 'all');
const DURATION_MS = Number(arg('duration', '30')) * 1000;
const N_USERS = Number(arg('users', '60'));
const PORT = Number(arg('port', '3100'));
const BASE = `http://127.0.0.1:${PORT}`;
const API_V1 = `${BASE}/api/v1`;

// ── apps/api dependencies + env (reuse the API's own client libs) ─────────────
const apiRequire = createRequire(path.join(API_DIR, 'package.json'));
const { PrismaClient } = apiRequire('@prisma/client');
const Redis = apiRequire('ioredis').default ?? apiRequire('ioredis');
const rootRequire = createRequire(path.join(ROOT, 'package.json'));
const { io: socketIo } = rootRequire('socket.io-client');

function parseDotEnv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const apiEnv = parseDotEnv(path.join(API_DIR, '.env'));
const DB_NAME = new URL(apiEnv.DATABASE_URL).pathname.slice(1).split('?')[0];

// Chirawa center — matches geo.service + seeds; small jitter keeps orders
// inside one delivery zone / batch radius.
const CENTER = { lat: 28.2403, lng: 75.6465 };
const jitter = () => (Math.random() - 0.5) * 0.004; // ~±220 m

const SEARCH_TERMS = ['aata', 'doodh', 'maggi', 'tel', 'rice', 'chai', 'sabun', 'biscuit', 'namak', 'dahi', 'aat', 'mag'];
const RIDER_PHONES = ['7700110001', '7700110002', '7700110003']; // prisma/seeds/riders.ts

// ── helpers ───────────────────────────────────────────────────────────────────
const authHeaders = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

async function post(pathname, body, token) {
  const res = await fetch(`${API_V1}${pathname}`, {
    method: 'POST',
    headers: token ? authHeaders(token) : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${pathname} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function login(phone) {
  const r = await post('/auth/verify-otp', { phone, otp: '123456' }); // dev bypass — setup only
  return r.tokens.accessToken;
}

function spawnProc(name, script, extraEnv, logDir) {
  const logFile = createWriteStream(path.join(logDir, `${name}.log`));
  const child = spawn('node', ['--enable-source-maps', script], {
    cwd: API_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'development',           // OTP bypass for identity setup
      LOG_LEVEL: 'info',                 // production log volume
      LOG_PRETTY: 'false',               // production log shape (no pino-pretty tax)
      RATE_LIMIT_DISABLED: 'true',       // measure the app, not the limiter
      OPERATING_HOURS_DISABLED: 'true',  // checkout runs at any wall-clock hour
      BATCH_WINDOW_MS: '2000',           // batches close fast → measurable assignment
      PORT: String(PORT),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(logFile);
  child.stderr.pipe(logFile);
  return child;
}

async function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('API /health never came up — check results/<run>/api.log');
}

// ── scenarios ─────────────────────────────────────────────────────────────────
function browseIteration(state) {
  const { products, categories } = state;
  return async ({ record, fail }) => {
    const roll = Math.random();
    if (roll < 0.35) {
      await timedJson(record, fail, 'GET /catalog/feed', `${API_V1}/catalog/feed`);
    } else if (roll < 0.55) {
      const cat = categories[Math.floor(Math.random() * categories.length)];
      await timedJson(record, fail, 'GET /catalog/products?category', `${API_V1}/catalog/products?category=${encodeURIComponent(cat)}&limit=20`);
    } else if (roll < 0.8) {
      const p = products[Math.floor(Math.random() * products.length)];
      await timedJson(record, fail, 'GET /catalog/products/:id', `${API_V1}/catalog/products/${p}`);
    } else if (roll < 0.9) {
      await timedJson(record, fail, 'GET /catalog/categories', `${API_V1}/catalog/categories`);
    } else {
      await timedJson(record, fail, 'GET /catalog/shops', `${API_V1}/catalog/shops`);
    }
  };
}

function searchIteration() {
  return async ({ record, fail, iter }) => {
    const q = SEARCH_TERMS[iter % SEARCH_TERMS.length];
    const sort = iter % 5 === 0 ? '&sort=rating' : '';
    await timedJson(record, fail, sort ? 'GET /search?sort=rating' : 'GET /search', `${API_V1}/search?q=${q}&limit=20${sort}`);
  };
}

function checkoutIteration(state, userSlice) {
  const { products } = state;
  return async ({ record, fail, worker }) => {
    const user = userSlice[worker % userSlice.length];
    const productId = products[Math.floor(Math.random() * products.length)];
    const add = await timedJson(record, fail, 'POST /cart/items', `${API_V1}/cart/items`, {
      method: 'POST', headers: authHeaders(user.token),
      body: JSON.stringify({ productId, quantity: 1 }),
    });
    if (!add) return;
    const cart = await timedJson(record, fail, 'GET /cart', `${API_V1}/cart`, { headers: authHeaders(user.token) });
    const cartId = cart?.cartId ?? cart?.id;
    if (!cartId) return;
    await timedJson(record, fail, 'POST /pricing/preview', `${API_V1}/pricing/preview`, {
      method: 'POST', headers: authHeaders(user.token),
      body: JSON.stringify({ cartId, addressId: user.addressId }),
    });
  };
}

function ordersIteration(state, userSlice, placed) {
  const { products } = state;
  return async ({ record, fail, worker, measuring }) => {
    const user = userSlice[worker % userSlice.length];
    const productId = products[Math.floor(Math.random() * products.length)];
    const add = await timedJson(record, fail, 'POST /cart/items', `${API_V1}/cart/items`, {
      method: 'POST', headers: authHeaders(user.token),
      body: JSON.stringify({ productId, quantity: 1 }),
    });
    if (!add) return;
    const cartId = add?.cartId ?? add?.id;
    if (!cartId) { fail('POST /cart/items', 'no cartId in response'); return; }
    const order = await timedJson(record, fail, 'POST /orders (COD place)', `${API_V1}/orders`, {
      method: 'POST', headers: authHeaders(user.token),
      body: JSON.stringify({ cartId, addressId: user.addressId, paymentMethod: 'cod' }),
    });
    if (order && measuring()) placed.push(order.orderId ?? order.body?.orderId);
  };
}

async function socketScenario(state, sampler, nSockets) {
  const tokens = state.users.map((u) => u.token);
  const connectMs = [];
  let failures = 0;
  const sockets = [];

  sampler.start();
  const t0 = performance.now();
  // Ramp in waves of 25 so we measure the server, not local dial bursts.
  for (let i = 0; i < nSockets; i += 25) {
    const wave = [];
    for (let j = i; j < Math.min(i + 25, nSockets); j++) {
      wave.push(new Promise((resolve) => {
        const started = performance.now();
        const s = socketIo(BASE, { auth: { token: tokens[j % tokens.length] }, transports: ['websocket'], reconnection: false, timeout: 10000 });
        sockets.push(s);
        s.on('connect', () => { connectMs.push(performance.now() - started); resolve(); });
        s.on('connect_error', () => { failures++; resolve(); });
      }));
    }
    await Promise.all(wave);
  }
  const rampMs = performance.now() - t0;
  const connected = sockets.filter((s) => s.connected).length;
  await new Promise((r) => setTimeout(r, 10000)); // hold: idle connection cost
  const resources = sampler.stop();
  for (const s of sockets) s.disconnect();

  const p = percentiles(connectMs);
  return {
    target_sockets: nSockets, connected, failures,
    ramp_seconds: Math.round(rampMs / 100) / 10,
    handshake_ms: p ? { p50: Math.round(p.p50), p95: Math.round(p.p95), p99: Math.round(p.p99), max: Math.round(p.max) } : null,
    resources,
  };
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = path.join(RESULTS_DIR, runId);
  mkdirSync(runDir, { recursive: true });

  console.log(`▶ load test ${runId} → ${runDir}`);
  const api = spawnProc('api', 'dist/index.js', {}, runDir);
  const worker = spawnProc('worker', 'dist/worker/index.js', {}, runDir);
  const prisma = new PrismaClient({ datasources: { db: { url: apiEnv.DATABASE_URL } } });
  const redis = new Redis(apiEnv.REDIS_URL, { lazyConnect: false });

  const results = {
    runId,
    config: { scenario: SCENARIO, durationMs: DURATION_MS, users: N_USERS, port: PORT },
    host: { platform: process.platform, node: process.version, cpus: (await import('node:os')).cpus().length },
    scenarios: {},
  };

  try {
    await waitForHealth();
    console.log('✓ API healthy; provisioning identities…');

    // Identities: N customers (auth → address) + the 3 seeded riders online.
    const users = [];
    for (let i = 0; i < N_USERS; i++) {
      const phone = `76100${String(i).padStart(5, '0')}`;
      const token = await login(phone);
      const addr = await post('/users/me/addresses', {
        street: `Load Test Street ${i}`, landmark: 'Near Bus Stand',
        locality: 'Main Market', pincode: '333026',
        lat: CENTER.lat + jitter(), lng: CENTER.lng + jitter(),
      }, token);
      users.push({ phone, token, addressId: addr.id ?? addr.address?.id });
    }
    const riders = [];
    for (const phone of RIDER_PHONES) {
      const token = await login(phone);
      riders.push({ phone, token });
    }
    const riderOnline = (r) =>
      fetch(`${API_V1}/delivery/availability`, {
        method: 'PATCH', headers: authHeaders(r.token),
        body: JSON.stringify({ status: 'online', lat: CENTER.lat + jitter(), lng: CENTER.lng + jitter() }),
      }).catch(() => {});
    await Promise.all(riders.map(riderOnline));

    const productsRaw = await (await fetch(`${API_V1}/catalog/products?limit=100`)).json();
    const products = (Array.isArray(productsRaw) ? productsRaw : productsRaw.products ?? productsRaw.items ?? [])
      .map((p) => p.id).filter(Boolean);
    const categoriesRaw = await (await fetch(`${API_V1}/catalog/categories`)).json();
    const categories = (Array.isArray(categoriesRaw) ? categoriesRaw : categoriesRaw.categories ?? [])
      .map((c) => c.name ?? c).filter(Boolean);
    if (products.length === 0) throw new Error('no products — run pnpm --filter @chirawa/api db:seed first');
    const state = { users, riders, products, categories };
    console.log(`✓ ${users.length} customers, ${riders.length} riders online, ${products.length} products, ${categories.length} categories`);

    const want = (name) => SCENARIO === 'all' || SCENARIO === name;
    const pids = { api: api.pid, worker: worker.pid };
    const runOne = async (name, cfg) => {
      console.log(`▶ scenario: ${name} (c=${cfg.concurrency}, ${DURATION_MS / 1000}s)…`);
      const sampler = new Sampler(pids, redis, prisma, DB_NAME);
      sampler.start();
      const summary = await runClosedLoop({ ...cfg, durationMs: DURATION_MS });
      summary.resources = sampler.stop();
      results.scenarios[name] = summary;
      console.log(`  ${summary.total_rps} rps, errors: ${Object.keys(summary.errors).length === 0 ? 'none' : JSON.stringify(summary.errors)}`);
    };

    if (want('browse'))   await runOne('browse',   { concurrency: 50, iteration: browseIteration(state) });
    if (want('search'))   await runOne('search',   { concurrency: 30, iteration: searchIteration() });
    if (want('checkout')) await runOne('checkout', { concurrency: 25, iteration: checkoutIteration(state, users.slice(0, 25)) });

    if (want('orders')) {
      const placed = [];
      const windowStart = new Date();
      // Riders saturate fast (3 riders, availability flips to on_delivery on
      // assignment) — a churn loop flips them back online every 2s so the
      // PIPELINE keeps getting exercised; rider capacity itself is a business
      // limit, not a perf property.
      const churn = setInterval(() => riders.forEach(riderOnline), 2000);
      await runOne('orders', { concurrency: 12, iteration: ordersIteration(state, users.slice(25, 37), placed) });
      console.log(`  waiting 20s for batching window + worker assignment…`);
      await new Promise((r) => setTimeout(r, 20000));
      clearInterval(churn);

      const rows = await prisma.$queryRawUnsafe(
        `SELECT EXTRACT(EPOCH FROM (da.assigned_at - o.confirmed_at)) * 1000 AS ms
         FROM orders o JOIN delivery_assignments da ON da.order_id = o.id
         WHERE o.confirmed_at >= '${windowStart.toISOString()}'`,
      );
      const unassigned = await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM orders o
         LEFT JOIN delivery_assignments da ON da.order_id = o.id
         WHERE o.confirmed_at >= '${windowStart.toISOString()}' AND da.id IS NULL`,
      );
      const lat = percentiles(rows.map((r) => Number(r.ms)));
      results.scenarios.rider_assignment = {
        orders_placed: placed.length,
        assigned: rows.length,
        unassigned: unassigned[0]?.n ?? null,
        batch_window_ms: 2000,
        confirm_to_assign_ms: lat
          ? { p50: Math.round(lat.p50), p95: Math.round(lat.p95), p99: Math.round(lat.p99), max: Math.round(lat.max) }
          : null,
      };
      console.log(`  assignment: ${rows.length} assigned, ${unassigned[0]?.n} unassigned`);
    }

    if (want('sockets')) {
      console.log('▶ scenario: sockets (ramp 300)…');
      const sampler = new Sampler(pids, redis, prisma, DB_NAME);
      results.scenarios.sockets = await socketScenario(state, sampler, 300);
      console.log(`  connected ${results.scenarios.sockets.connected}/300, failures ${results.scenarios.sockets.failures}`);
    }
  } finally {
    api.kill('SIGTERM');
    worker.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1500));
    await prisma.$disconnect().catch(() => {});
    redis.disconnect();
  }

  const outFile = path.join(runDir, 'results.json');
  writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`\n✅ done → ${outFile}`);
  console.log(JSON.stringify(results.scenarios, null, 2));
}

main().catch((err) => {
  console.error('❌ load test failed:', err);
  process.exit(1);
});
