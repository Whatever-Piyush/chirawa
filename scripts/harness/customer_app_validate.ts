/**
 * customer_app_validate.ts — runtime validation of the CUSTOMER-APP flows.
 *
 * Drives the EXACT client the app bundles: ChirawaApiClient from
 * packages/api-client/src/index.ts (Metro "main" → src), plus the same
 * socket.io-client. Points at the live dev API on :3000 (same target the app
 * uses via http://<host>:3000/api/v1). No backend code is modified.
 *
 * Run:  apps/api/node_modules/.bin/tsx scripts/harness/customer_app_validate.ts
 */
import { ChirawaApiClient, ApiError } from '../../packages/api-client/src/index';
import type { TokenStorage } from '../../packages/api-client/src/index';
import { io } from 'socket.io-client';

const API = 'http://localhost:3000/api/v1';
const SOCKET = 'http://localhost:3000';

const CUST_PHONE   = '9000000001';
const SELLER_PHONE = '9001110001';   // owns shop 2259f27d (Chirawa Store) via seller_profiles
const RIDER_PHONE  = '7700110001';
const ADMIN_PHONE  = '9999900001';
const PRODUCT_ID   = '369777cf-b188-5c2a-93b3-a814f9fa50dd'; // Tata Tea Gold, in-stock
const OTP          = '123456';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (s?: string | null) => (s ? `${s.slice(0, 12)}…(${s.length})` : String(s));
function line(tag: string, msg: string) { console.log(`${tag} ${msg}`); }
function ev(label: string, obj: unknown) { console.log(`    ${label}: ${JSON.stringify(obj)}`); }

// In-memory TokenStorage — same interface the app's SecureStore-backed
// StorageService implements; the client can't tell the difference.
function memStore(): TokenStorage & { _at: string | null; _rt: string | null } {
  const s = {
    _at: null as string | null,
    _rt: null as string | null,
    getAccessToken: async () => s._at,
    getRefreshToken: async () => s._rt,
    setTokens: async (t: { accessToken: string; refreshToken: string }) => { s._at = t.accessToken; s._rt = t.refreshToken; },
    clearTokens: async () => { s._at = null; s._rt = null; },
  };
  return s;
}

// Raw authed call for the seller/rider/admin transitions that drive status
// changes (these actors are NOT the customer-app; the customer client stays pure).
async function rawLogin(phone: string): Promise<string> {
  const r = await fetch(`${API}/auth/verify-otp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, otp: OTP }),
  });
  const j = await r.json() as any;
  if (!r.ok || !j?.tokens?.accessToken) throw new Error(`login(${phone}) failed: HTTP ${r.status} ${JSON.stringify(j)}`);
  return j.tokens.accessToken as string;
}
async function authed(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`${API}${path}`, {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let j: any = null; try { j = await r.json(); } catch { /* 204 etc */ }
  return { status: r.status, json: j };
}

const results: Record<string, string> = {};

async function main() {
  const cust = memStore();
  const api = new ChirawaApiClient(API, cust);
  let productId = PRODUCT_ID;
  let cartId = '';
  let addressId = '';
  let orderId = '';

  // ───────────────────────── 1. LOGIN ─────────────────────────
  console.log('\n========== 1. LOGIN ==========');
  try {
    const res = await api.verifyOtp({ phone: CUST_PHONE, otp: OTP } as any);
    const at = await cust.getAccessToken();
    ev('verifyOtp.tokens', { accessToken: short((res as any).tokens?.accessToken), refreshToken: short((res as any).tokens?.refreshToken) });
    ev('storage.accessToken (set by client)', short(at));
    results['1 Login'] = at ? 'PASS' : 'FAIL';
    line(at ? '✅' : '❌', `login ${CUST_PHONE} → ${at ? 'tokens stored in client' : 'no token'}`);
  } catch (e: any) { results['1 Login'] = 'FAIL'; line('❌', `login threw: ${e.message}`); return; }

  // ───────────────────────── 2. BROWSE ─────────────────────────
  console.log('\n========== 2. BROWSE PRODUCTS ==========');
  try {
    const feed: any = await api.getFeed();
    const prods: any = await api.getProducts({ limit: 5 });
    const cats: any = await api.getCategories();
    const feedArr = Array.isArray(feed) ? feed : (feed?.data ?? feed?.products ?? feed?.items);
    const prodArr = Array.isArray(prods) ? prods : (prods?.data ?? prods?.products ?? prods?.items);
    const catArr  = Array.isArray(cats) ? cats : (cats?.data ?? cats?.categories);
    ev('getFeed → count', Array.isArray(feedArr) ? feedArr.length : typeof feed);
    ev('getFeed[0]', Array.isArray(feedArr) ? { id: feedArr[0]?.id ?? feedArr[0]?.productId, name: feedArr[0]?.name } : feed);
    ev('getProducts → count', Array.isArray(prodArr) ? prodArr.length : typeof prods);
    ev('getCategories → count', Array.isArray(catArr) ? catArr.length : typeof cats);
    // prefer a product id straight from the live feed (proves browse → addable id)
    const fromFeed = Array.isArray(feedArr) ? (feedArr[0]?.id ?? feedArr[0]?.productId) : undefined;
    if (fromFeed) { productId = fromFeed; ev('chosen productId (from feed)', productId); }
    const ok = (Array.isArray(feedArr) && feedArr.length > 0) || (Array.isArray(prodArr) && prodArr.length > 0);
    results['2 Browse'] = ok ? 'PASS' : 'FAIL';
    line(ok ? '✅' : '❌', `browse → feed=${Array.isArray(feedArr) ? feedArr.length : '?'} products=${Array.isArray(prodArr) ? prodArr.length : '?'} categories=${Array.isArray(catArr) ? catArr.length : '?'}`);
  } catch (e: any) { results['2 Browse'] = 'FAIL'; line('❌', `browse threw: ${e.message}`); }

  // ───────────────────────── 3. ADD TO CART ─────────────────────────
  console.log('\n========== 3. ADD TO CART ==========');
  try {
    await api.clearCart().catch(() => {});
    const cart: any = await api.addToCart({ productId, quantity: 2 } as any);
    cartId = cart?.cartId ?? '';
    const items = cart?.items ?? [];
    ev('addToCart → cartId', cartId);
    ev('addToCart → items', items.map((i: any) => ({ productId: i.productId, name: i.name ?? i.productName, qty: i.quantity })));
    ev('addToCart → totals', { subtotal: cart?.subtotal, total: cart?.total, itemCount: cart?.itemCount });
    const got = await api.getCart();
    cartId = (got as any)?.cartId ?? cartId;
    const ok = Array.isArray(items) && items.length > 0 && !!cartId;
    results['3 Cart'] = ok ? 'PASS' : 'FAIL';
    line(ok ? '✅' : '❌', `cart has ${items.length} line(s), cartId=${short(cartId)}`);
  } catch (e: any) { results['3 Cart'] = 'FAIL'; line('❌', `addToCart threw: ${e instanceof ApiError ? `${e.statusCode} ${e.message}` : e.message}`); }

  // ───────────────────────── 4. CHECKOUT ─────────────────────────
  console.log('\n========== 4. CHECKOUT ==========');
  try {
    let addrs: any = await api.getAddresses();
    if (!Array.isArray(addrs) || addrs.length === 0) {
      const a: any = await api.createAddress({
        street: 'Harness 1', landmark: 'Near temple', locality: 'Bazaar', city: 'Chirawa',
        pincode: '333026', lat: 28.2403, lng: 75.6466, contactType: 'myself',
      } as any);
      addressId = a?.id;
      ev('createAddress → id', addressId);
      addrs = await api.getAddresses();
    } else { addressId = addrs[0].id; ev('existing address → id', addressId); }
    const pricing: any = await api.getPricingPreview({ cartId, addressId } as any);
    ev('getPricingPreview', { subtotal: pricing?.subtotal, deliveryFee: pricing?.deliveryFee, discount: pricing?.discount, total: pricing?.total ?? pricing?.totalAmount });
    const ok = !!addressId && pricing && (pricing.total != null || pricing.totalAmount != null || pricing.subtotal != null);
    results['4 Checkout'] = ok ? 'PASS' : 'FAIL';
    line(ok ? '✅' : '❌', `address=${short(addressId)} pricingTotal=${pricing?.total ?? pricing?.totalAmount ?? pricing?.subtotal}`);
  } catch (e: any) { results['4 Checkout'] = 'FAIL'; line('❌', `checkout threw: ${e instanceof ApiError ? `${e.statusCode} ${e.message}` : e.message}`); }

  // ───────────────────────── 5. PLACE ORDER ─────────────────────────
  console.log('\n========== 5. PLACE ORDER (COD) ==========');
  try {
    const res: any = await api.placeOrder({ cartId, addressId, paymentMethod: 'cod' as any });
    orderId = res?.orderId ?? '';
    ev('placeOrder → response', { orderId: res?.orderId, orderIds: res?.orderIds, groupId: res?.groupId, status: res?.status });
    results['5 PlaceOrder'] = orderId ? 'PASS' : 'FAIL';
    line(orderId ? '✅' : '❌', `placeOrder → orderId=${orderId}`);
  } catch (e: any) { results['5 PlaceOrder'] = 'FAIL'; line('❌', `placeOrder threw: ${e instanceof ApiError ? `${e.statusCode} ${e.message} [${e.code}]` : e.message}`); }
  if (!orderId) { summary(); return; }

  // ───────────────────────── 6. ORDER PLACED SCREEN ─────────────────────────
  console.log('\n========== 6. ORDER PLACED SCREEN (getOrder) ==========');
  try {
    const o: any = await api.getOrder(orderId);
    ev('getOrder', { id: o?.id, status: o?.status, paymentMethod: o?.paymentMethod, total: o?.totalAmount ?? o?.total, items: (o?.items ?? []).map((i: any) => ({ name: i.productName ?? i.name, qty: i.quantity })) });
    const ok = o?.id === orderId && !!o?.status;
    results['6 OrderPlaced'] = ok ? 'PASS' : 'FAIL';
    line(ok ? '✅' : '❌', `order ${short(orderId)} status=${o?.status} total=${o?.totalAmount ?? o?.total}`);
  } catch (e: any) { results['6 OrderPlaced'] = 'FAIL'; line('❌', `getOrder threw: ${e instanceof ApiError ? `${e.statusCode} ${e.message}` : e.message}`); }

  // ───────────────────────── 7. ORDER TRACKING SCREEN ─────────────────────────
  console.log('\n========== 7. ORDER TRACKING SCREEN (getOrder + getRiderLocation) ==========');
  try {
    const o: any = await api.getOrder(orderId);
    let loc: any = null; try { loc = await api.getRiderLocation(orderId); } catch (e: any) { loc = { error: e instanceof ApiError ? `${e.statusCode} ${e.message}` : e.message }; }
    ev('tracking.getOrder', { status: o?.status, eta: o?.eta ?? null });
    ev('tracking.getRiderLocation', loc);
    const ok = !!o?.status; // tracking screen renders off order.status; rider location may be null pre-dispatch
    results['7 Tracking'] = ok ? 'PASS' : 'FAIL';
    line(ok ? '✅' : '❌', `tracking status=${o?.status} riderLocation=${loc?.location ? 'present' : 'null (expected pre-dispatch)'}`);
  } catch (e: any) { results['7 Tracking'] = 'FAIL'; line('❌', `tracking threw: ${e instanceof ApiError ? `${e.statusCode} ${e.message}` : e.message}`); }

  // ───────────────────────── 8. SOCKET UPDATES DURING STATUS CHANGES ─────────────────────────
  console.log('\n========== 8. SOCKET UPDATES (live order:status during transitions) ==========');
  const received: Array<{ t: string; event: string; data: any }> = [];
  const token = await cust.getAccessToken();
  const socket = io(SOCKET, { auth: { token }, transports: ['websocket'], reconnection: false });
  const lifecycle: string[] = [];
  socket.on('connect', () => { lifecycle.push('connect'); socket.emit('order:subscribe', orderId); });
  socket.on('connect_error', (err: any) => lifecycle.push(`connect_error:${err?.message}`));
  socket.on('disconnect', (r: any) => lifecycle.push(`disconnect:${r}`));
  for (const evt of ['order:status', 'order:location', 'order:eta', 'order:item-unavailable']) {
    socket.on(evt, (data: any) => { received.push({ t: new Date().toISOString(), event: evt, data }); console.log(`    📩 ${evt} ← ${JSON.stringify(data)}`); });
  }

  // wait for connect (max 5s)
  for (let i = 0; i < 50 && !lifecycle.includes('connect'); i++) await sleep(100);
  ev('socket lifecycle', lifecycle);
  if (!lifecycle.includes('connect')) {
    results['8 Socket'] = 'FAIL';
    line('❌', `socket did not connect: ${JSON.stringify(lifecycle)}`);
    socket.close(); summary(); return;
  }
  line('✅', 'customer socket connected + emitted order:subscribe');
  await sleep(400);

  // Drive real status transitions as seller/rider/admin → each should emit order:status to the order room.
  console.log('  -- driving backend status transitions (seller/rider/admin) --');
  const sellerT = await rawLogin(SELLER_PHONE);
  const riderT  = await rawLogin(RIDER_PHONE);
  const adminT  = await rawLogin(ADMIN_PHONE);
  const statusNow = async () => (await authed(token!, 'GET', `/orders/${orderId}`)).json?.status;
  ev('status after place', await statusNow());

  const drive = async (label: string, fn: () => Promise<{ status: number; json: any }>) => {
    const r = await fn();
    await sleep(900); // let the socket event land
    const st = await statusNow();
    console.log(`    → ${label}: HTTP ${r.status}${r.status >= 400 ? ` (${JSON.stringify(r.json)?.slice(0, 140)})` : ''}  | order.status=${st}`);
  };

  await drive('seller accept',    () => authed(sellerT, 'POST', `/orders/${orderId}/accept`, {}));
  await drive('seller preparing', () => authed(sellerT, 'POST', `/orders/${orderId}/preparing`, {}));
  await drive('seller ready',     () => authed(sellerT, 'POST', `/orders/${orderId}/ready`, {}));
  await drive('rider online',     () => authed(riderT,  'PATCH', `/delivery/availability`, { status: 'online', lat: 28.2403, lng: 75.6466 }));
  await drive('admin assign',     () => authed(adminT,  'POST', `/delivery/orders/${orderId}/assign`, {}));
  await drive('rider pickup',     () => authed(riderT,  'POST', `/delivery/orders/${orderId}/pickup`, {}));
  await drive('rider start',      () => authed(riderT,  'POST', `/delivery/orders/${orderId}/start-delivery`, {}));

  // settle window for trailing emits
  await sleep(1500);
  const statusEvents = received.filter((r) => r.event === 'order:status');
  console.log(`  -- socket events received on customer socket: ${received.length} (order:status=${statusEvents.length}) --`);
  for (const r of received) console.log(`     ${r.t}  ${r.event}  ${JSON.stringify(r.data)}`);
  results['8 Socket'] = statusEvents.length > 0 ? 'PASS' : 'FAIL';
  line(statusEvents.length > 0 ? '✅' : '❌', `received ${statusEvents.length} live order:status socket event(s)`);

  socket.emit('order:unsubscribe', orderId);
  socket.close();
  summary();
}

function summary() {
  console.log('\n================= CUSTOMER-APP FLOW VERDICTS =================');
  for (const [k, v] of Object.entries(results)) console.log(`  ${v === 'PASS' ? '✅' : '❌'} ${k.padEnd(16)} ${v}`);
  console.log('=============================================================');
}

main().then(() => process.exit(0)).catch((e) => { console.error('DRIVER CRASH:', e); process.exit(1); });
