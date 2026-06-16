# Setup & "I can't add items" fix

Quickstart for getting a dev environment running after `git pull`, plus the #1
gotcha: **browsing is public, but adding to cart requires being logged in.**

> Full details live in [`README.md`](./README.md). This is the short version.

---

## 🔑 If products show but tapping **ADD** errors / does nothing

You're **not logged in**. Catalog reads (`/products`, `/shops`) are public, so you
see items — but every cart write needs an authenticated user, so `ADD` 401s.

**Fix — log in with the dev OTP:**

1. Open the app → login screen → enter **any 10-digit phone number** → *Send OTP*.
2. Enter **`123456`** — in `NODE_ENV=development` this code always works.
   - No SMS is sent in dev (`FAST2SMS_API_KEY=placeholder`). The real code is also
     printed in the **API terminal**: `🔐 DEV OTP for <phone>: <code>`.
3. Once logged in, **ADD works immediately.**

If the app *looks* logged in but ADD still fails → **log out and back in** with
`123456` (stale/invalid token).

---

## 🚀 First-time setup (after `git pull`)

```bash
pnpm install                                   # installs every workspace (incl. expo-contacts)
```

### 1. Backend env — `apps/api/.env`
```bash
cp apps/api/.env.example apps/api/.env
node scripts/generate-dev-keys.mjs             # prints JWT_PRIVATE_KEY + JWT_PUBLIC_KEY
```
Paste the two printed lines into `apps/api/.env`. Leave the rest as placeholders
(FCM/Razorpay/SMS are stubbed in dev).

### 2. Start Postgres + Redis (needs Docker Desktop running)
```bash
docker compose up -d                           # 5432 (postgis) / 6379 (redis)
```

### 3. Create + seed the database
```bash
pnpm --filter @chirawa/api db:migrate          # apply all migrations
pnpm --filter @chirawa/api db:seed             # 6 shops + ~231 products
```

### 4. Run the API
```bash
pnpm dev:api                                   # Fastify on 0.0.0.0:3000
```

### 5. Run the customer app
```bash
cd apps/customer-app
cp .env.example .env
# edit .env → EXPO_PUBLIC_API_HOST below
pnpm start
```

| Running the app on… | `EXPO_PUBLIC_API_HOST` |
|---|---|
| Physical device (same Wi-Fi) | your Mac's LAN IP — `ipconfig getifaddr en0` |
| Android emulator | `10.0.2.2` |
| iOS simulator | `localhost` |

Then **log in with `123456`** (see top) and add items. ✅

---

## 📦 About the catalog data

`db:seed` is deterministic and idempotent — it rebuilds the **6 standard shops
(~231 products)** in code (`apps/api/prisma/seeds/shops.ts`). That's plenty to
browse and add items.

**Git ships code, not database rows.** Any shops/products added by hand through the
seller app live only in that person's local Postgres and are *not* reproduced by
`db:seed`. To share custom catalog data, it must be baked into `seeds/shops.ts`.
