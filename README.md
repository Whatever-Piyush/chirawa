# Bringly (Chirawa) — Quick-Commerce Platform

Monorepo: a Fastify **API** + 3 Expo (React Native) apps — **customer**, **seller**, **rider** —
sharing packages, backed by **Postgres + Redis** in Docker. Package manager is **pnpm**.

```
apps/
  api/            Fastify backend (REST + Socket.io + BullMQ worker)
  customer-app/   Expo — shopper app
  seller-app/     Expo — shop owner app
  rider-app/      Expo — delivery rider app
packages/
  api-client/     Shared typed API client
  types/          Shared DTOs / domain types
  i18n/           Shared translations (en / hi)
scripts/          dev key generator, db init, test helpers
docker-compose.yml
```

---

## Prerequisites (macOS, incl. Apple Silicon / M1)

```bash
# Homebrew (skip if installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node            # Node ≥ 20
npm  install -g pnpm         # pnpm ≥ 9
brew install --cask docker   # Docker Desktop (Postgres + Redis)
brew install watchman        # recommended for React Native
npm  install -g eas-cli expo # Expo / EAS CLI
```
Launch **Docker Desktop** once so the daemon runs. To run the apps you'll also want an
**Android device** (with our dev-client APK) and/or **Android Studio** (emulator).

---

## First-time setup

```bash
git clone https://github.com/Whatever-Piyush/chirawa.git
cd chirawa
pnpm install                 # installs every workspace
```

### 1. Backend env (`apps/api/.env`)
`.env` is git-ignored, so create it:
```bash
cp apps/api/.env.example apps/api/.env
node scripts/generate-dev-keys.mjs     # prints JWT_PRIVATE_KEY + JWT_PUBLIC_KEY
```
Paste the two printed lines into `apps/api/.env`. Leave the rest as placeholders
(`FCM_SERVICE_ACCOUNT_JSON={}`, Razorpay, etc.) — in dev, FCM just logs instead of
sending and payments use COD.

### 2. Start Postgres + Redis
```bash
docker compose up -d         # ports 5432 (postgis) / 6379 (redis)
```

### 3. Create + seed the database
```bash
pnpm --filter @chirawa/api db:migrate
pnpm --filter @chirawa/api db:seed
```

### 4. Run the API
```bash
pnpm dev:api                 # Fastify on 0.0.0.0:3000  (tsx watch)
```

---

## Running an app

Each app reads its dev API host from **`EXPO_PUBLIC_API_HOST`**. Set it once per machine:

```bash
cd apps/customer-app
cp .env.example .env
# edit .env → EXPO_PUBLIC_API_HOST=<value>
```
Pick the value for your setup:
| Running on | `EXPO_PUBLIC_API_HOST` |
|---|---|
| Physical device (same Wi-Fi) | your Mac's LAN IP — `ipconfig getifaddr en0` |
| Android emulator | `10.0.2.2` |
| iOS simulator | `localhost` |

Then start Metro:
```bash
pnpm start                   # from apps/customer-app
```

> **These are dev-client builds, not Expo Go** (they use native modules — Firebase,
> secure-store). To open one:
> - Easiest: install the team's **EAS dev-client APK** on an Android phone, open it,
>   and enter `http://<your-mac-ip>:8081`.
> - Or build your own: `eas build --profile development --platform android`
>   (needs an Expo account added to the EAS project).
>
> `google-services.json` is already committed for all three apps — no Firebase file setup needed.

Run the other apps the same way (`apps/seller-app`, `apps/rider-app`). Run **one Metro per
app** — if a port is taken Expo offers the next (8082, 8083); make sure each device connects
to the matching port.

---

## Common commands

| Task | Command |
|---|---|
| Start DB services | `docker compose up -d` |
| Stop DB services | `docker compose down` |
| Run API | `pnpm dev:api` |
| Run background worker | `pnpm --filter @chirawa/api worker` |
| Migrate DB | `pnpm --filter @chirawa/api db:migrate` |
| Reset DB (wipe + reseed) | `pnpm --filter @chirawa/api db:reset` |
| Prisma Studio (DB GUI) | `pnpm db:studio` |
| Seed DB | `pnpm --filter @chirawa/api db:seed` |
| Run an app | `cd apps/<app> && pnpm start` |
| Typecheck all | `pnpm typecheck` |
| Test all | `pnpm test:all` |

---

## Notes / gotchas

- **Default branch is `main`**; commit/push there (or branch off it).
- **Single Metro per app.** Port collisions auto-bump; connect the device to the right port.
- **FCM in dev**: without a real `FCM_SERVICE_ACCOUNT_JSON`, push notifications are logged
  to the API console instead of delivered — fine for most dev work.
- **Payments**: only COD works in dev (Razorpay keys are placeholders).
- Seeded test data includes shops/products and login users — check `apps/api/prisma/seed.ts`.
