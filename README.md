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
> secure-store), so Expo Go cannot run them. You need the dev-client APK installed once;
> after that, `pnpm start` + the dev client is your daily loop. See **Dev builds** below.

Run the other apps the same way (`apps/seller-app`, `apps/rider-app`). Run **one Metro per
app** — if a port is taken Expo offers the next (8082, 8083); make sure each device connects
to the matching port.

---

## Dev builds (the custom dev client)

Each app has an EAS `development` profile (`apps/<app>/eas.json`) that produces an
installable **Android APK dev client**. `google-services.json` is committed for all three
apps, so there's no Firebase file setup.

### A. Install the team's existing dev build (fastest)
The quickest path for a new teammate — no build needed:
1. Owner gets a shareable link to the latest dev APK:
   ```bash
   cd apps/customer-app
   eas build:list --platform android --profile development --limit 1
   ```
   Open that build in the EAS dashboard (or `eas build:view <id>`) and copy the **install URL**
   (or just re-run a build, below — EAS prints a QR + URL at the end).
2. Send the teammate the URL. On their Android phone: open it, download, allow
   "install unknown apps", install.
3. Open the installed **dev client**, then connect to Metro: scan the QR from `pnpm start`,
   or tap "Enter URL manually" → `http://<your-mac-ip>:8081`.

### B. Build your own dev client
Needs an Expo account that's a member of the EAS project (ask the owner to add you, or run
`eas init` if the app isn't linked yet — it sets `extra.eas.projectId` in `app.json`).
```bash
npx expo login                 # once
cd apps/customer-app
eas build --profile development --platform android
```
EAS runs the build in the cloud (~10–15 min) and prints a QR + install URL at the end —
install it like in (A). Repeat per app you need (`seller-app`, `rider-app`).

### C. iOS (optional, for simulator work)
```bash
cd apps/customer-app
eas build --profile development --platform ios   # add --local to build on your Mac
```
For a **physical iPhone** you must register it first: `eas device:create`. The Android flow
above is the primary/dev-tested path.

> Rebuild the dev client only when **native** deps change (new Expo module, Firebase, etc.).
> Pure JS/TS changes just need `pnpm start` + reload — no rebuild.

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
