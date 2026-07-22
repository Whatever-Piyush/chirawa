# Bringly — Production Identity Migration (`com.chirawa.*` → `in.bringly.*`) — FINAL

**Date:** 2026-07-16 · **Decision:** LOCKED — permanent Android identity is `in.bringly.{customer,seller,rider}`.
**Given (accepted as fact):** never published; no Play release on any track; no internal-testing release; zero production users.
**Status of this document:** **complete & internally verified** against the working tree this session. Every dependency below was traced to source (file:line / command output). This is the Builder's execution reference — it is intended to be exhaustive enough that **no additional package-related issue should surface during execution**.
**Boundaries:** repo edits are mine to make on your go; all **console/dashboard** actions (Firebase, Google Cloud, Play, Expo/EAS credentials) are marked **[console]** and are yours to run or delegate. Device checks are **[device]**. The first `eas submit` is a one-way door and is the last step.

---

## Executive Summary

With **nothing published and zero users**, this is a **rename, not a data migration**. Full tracing confirms the change is small and self-contained:

- **Firebase project is reused, not recreated.** Backend push uses a **project-scoped service-account** (`apps/api/src/modules/notifications/fcm.service.ts:31-34`, `admin.credential.cert`), and the project `bringly-b71c9` (#559741289279) is already Bringly-branded. Register three **new Android apps** inside it → **backend unchanged, no token migration** (all apps mint native FCM tokens via `getDevicePushTokenAsync`, and there are no users).
- **No custom native code.** Only prebuild-generated `MainActivity.kt`/`MainApplication.kt` exist (both `package com.chirawa.customer`), and `app.config.js` has **no** package-pinning plugin. `expo prebuild --clean` regenerates `applicationId`, `namespace`, Kotlin package dirs, and `AndroidManifest` from `app.json`. The manifest hardcodes **nothing** — it uses `${applicationId}` throughout.
- **No OAuth, no Firebase client SDK, no App Links yet.** `google-services.json` `oauth_client: []` (phone-OTP auth — nothing to migrate); no `@react-native-firebase`/Analytics/Crashlytics/App-Check in any app; no `assetlinks.json` hosted (App Links not verified yet).
- **CI does not build the apps.** `ci.yml` is typecheck/lint; `deploy.yml`/`rollback.yml` are backend-only. EAS builds are manual → **no CI changes required**.
- **EAS project IDs are kept.** `projectId` is independent of package, so **OTA and EAS builds are unaffected in identity terms**; OTA is currently disabled anyway (`expo.modules.updates.ENABLED=false`).

**Net change = 3 `app.json` package fields + 3 `google-services.json` replacements + Maps key re-restrict/rotate + delete the stray root `app.json`/`eas.json` + refresh 4 doc/comment strings + rebuild.** Backend: 0 changes. **Effort ≈ 3.5–4 engineer-days**, ~half console/device. The only irreversible step is the first Play submit — gated to last.

---

## Complete Dependency Trace (every surface, with evidence)

Legend — **Verdict:** `CHANGE` (Builder edits) · `REGEN` (prebuild output) · `REPLACE` (new file from console) · `CONSOLE` (dashboard action) · `KEEP` · `NO-CHANGE` · `OUT-OF-SCOPE`.

### ANDROID
| Item | Evidence (verified) | Verdict |
|---|---|---|
| `applicationId` | `android/app/build.gradle:92` = `com.chirawa.customer` (gitignored, prebuild output) | **REGEN** from `app.json` package |
| `namespace` | `android/app/build.gradle:90` = `com.chirawa.customer` | **REGEN** |
| Kotlin/Java package decls | `MainActivity.kt:1`, `MainApplication.kt:1` = `package com.chirawa.customer`; **these are the only 2 native source files** (no custom native) | **REGEN** → `in/bringly/customer/…` |
| `AndroidManifest.xml` | **No hardcoded package** — `${applicationId}` throughout; FileProvider/authorities auto-follow; meta-data = notification color + `updates.ENABLED=false`; schemes `bringly`, `exp+bringly-customer`, `https` `<queries>` | **REGEN** (nothing to hand-edit) |
| Gradle | `google-services` plugin applied `android/app/build.gradle:184`; classpath `com.google.gms:google-services:4.4.1` `android/build.gradle:9` (reads `google-services.json`) | **REGEN** (ensure new `google-services.json` present first) |
| Generated native folders | Only **customer-app** has a **stale local `android/`** (gitignored); seller/rider are pure managed (no native dirs) | **DELETE local `android/`** then `prebuild --clean` (or let EAS managed build prebuild) |

### EXPO
| Item | Evidence | Verdict |
|---|---|---|
| `app.json` package (×3) | `customer:24` `com.chirawa.customer` · `seller:16` `com.chirawa.seller` · `rider:16` `com.chirawa.rider` | **CHANGE** → `in.bringly.*` |
| `app.config.js` | customer only; spreads `app.json`, injects Maps key (package-independent); header comment names `com.chirawa.customer` | **CHANGE (comment text only)**; seller/rider have none |
| `eas.json` | customer (`local`, app-bundle) · seller (`remote`, autoIncrement) · rider (`local`, app-bundle); **no package refs in any** (package comes from `app.json`) | **NO-CHANGE** (except delete root, below) |
| Root `app.json` / `eas.json` | root `app.json` **untracked** (`in.bringly.customer`, projectId `3c4033eb`); root `eas.json` **staged** | **DELETE** (phantom; do NOT promote) |
| Expo Project ID | customer `db00e0a8` (owner `piyushlatta`) · rider `ccfa51fb` (owner **`aaaaaadiii`** ⚠️) · **seller: none** · phantom `3c4033eb` | **KEEP** db00e0a8/ccfa51fb; **link** seller (`eas init`); **abandon** 3c4033eb |
| `runtimeVersion` | absent in all 3 | **KEEP** (set a policy when OTA is enabled later) |
| OTA compatibility | `expo.modules.updates.ENABLED=false` (manifest); no `updates` block | **NO-CHANGE** — OTA binds to `projectId` (kept), not package |

### FIREBASE
| Item | Evidence | Verdict |
|---|---|---|
| Project | `google-services.json` → `bringly-b71c9` / #559741289279 (already Bringly-branded) | **KEEP** (do NOT recreate) |
| New Android app registration | none for `in.bringly.*` yet | **CONSOLE** — register 3 apps in `bringly-b71c9`; add release SHA-1 + SHA-256 |
| `google-services.json` (×3) | carry `package_name` + unique **`mobilesdk_app_id`** (package-bound: customer `1:559741289279:android:96c24fc2ba4482a506898a`); multi-client (rider file has 3 client entries) | **REPLACE** with fresh downloads (each must contain its app's new package) |
| FCM | project-scoped service-account (`fcm.service.ts:31-34`); client `getDevicePushTokenAsync()` = native FCM token, **Firebase-app/package-bound** (`notifications.ts:65`, all 3 apps) | **NO-CHANGE backend**; google-services swap is **HARD-required** so tokens mint for the new app; 0 tokens to migrate |
| Analytics | `google-services analytics:true` **but no `@react-native-firebase/analytics`** anywhere → dormant, not collecting | **NO-CHANGE** (new app_id picked up automatically if wired later) |
| Crash reporting | none (no Crashlytics/Sentry in app) | **NO-CHANGE** (future add uses new app_id) |
| App Check | none | **NO-CHANGE** (enroll new app + SHA when enabled) |

### GOOGLE
| Item | Evidence | Verdict |
|---|---|---|
| Maps API restriction | key injected by `app.config.js`; restricted (per `.env.example:13`) to `com.chirawa.customer` + SHA-1; **only customer renders maps** (seller/rider don't) | **CONSOLE** — rotate (prior audit S1 compromise) + re-restrict to `in.bringly.customer` + SHA-1 |
| SHA-1 / SHA-256 | from EAS-managed keystore (`eas credentials`) | **CONSOLE** — keep **one** keystore (stable SHA); register in Firebase + Maps (SHA-1) + assetlinks (SHA-256) |
| OAuth client IDs | `google-services.json oauth_client: []` → **none** (phone-OTP auth) | **NO-CHANGE** (nothing exists) |
| Firebase/Google API key | `google-services api_key[]` present (distinct from Maps key) | **REPLACE** via new google-services; **CONSOLE** if it's app-restricted, add new package+SHA |
| Asset Links / App Links | **no `assetlinks.json`** in repo; `https` entry is a `<queries>` block (for `canOpenURL`), **not** an autoVerify App-Links filter → App Links not live | **CONSOLE (deferred)** — when hosting `bringly.in/.well-known/assetlinks.json`, use new package + SHA-256 |
| Custom scheme deep links | `bringly://` (`AppNavigator.tsx:126`), `exp+bringly-customer` | **NO-CHANGE** (package-independent) |

### BACKEND
| Item | Evidence | Verdict |
|---|---|---|
| FCM targeting | token-based via service account; graceful invalid-token handling (`fcm.service.ts` catch) | **NO-CHANGE** |
| Deep links | backend embeds no scheme/package; in-app nav via `data.screen` | **NO-CHANGE** |
| Notification payloads / channel IDs | backend uses `chirawa_orders/alerts/general` (`fcm.service.ts:53,82`; `notifications.plugin.ts:190,215,240`); client defines the same IDs (`notifications.ts:17,25,34`, all 3 apps) — a **package-independent client↔server contract** | **NO-CHANGE** (out of scope; see note) |
| Package/bundle/applicationId refs | none found in `apps/api/src` | **NO-CHANGE** |

> **Notification-channel note (deliberately OUT-OF-SCOPE):** the `chirawa_*` channel IDs are arbitrary strings, not the package name, and keep working under `in.bringly.*`. If a future brand-cleanup renames them to `bringly_*`, it is a **coordinated 6-file change** — client `notifications.ts` (×3: customer/seller/rider, lines 17/25/34) **and** backend `fcm.service.ts:53,82` + `notifications.plugin.ts:190,215,240` — done in lockstep, and best done **now while there are 0 users** (Android channel IDs are immutable once created on a device). Not required for this migration; listed so it is never "discovered later."

### CI / CD
| Item | Evidence | Verdict |
|---|---|---|
| `ci.yml` | typecheck/lint only; no `eas`/app build | **NO-CHANGE** |
| `deploy.yml`, `rollback.yml` | backend-only; no `eas`/app/package refs | **NO-CHANGE** |
| EAS Build / release profiles | manual/local; profiles in `eas.json` derive package from `app.json` | **NO-CHANGE** |

### DOCUMENTATION / COMMENTS
| File:line | Content | Verdict |
|---|---|---|
| `apps/customer-app/.env.example:13` | Maps restriction note names `com.chirawa.customer` | **CHANGE** → `in.bringly.customer` |
| `apps/customer-app/app.config.js` (header) | comment names `com.chirawa.customer` | **CHANGE (text)** |
| `docs/PRODUCTION_READINESS_CHECKLIST.md:97,114` | Maps/package refs | **CHANGE (text)** |
| `docs/FOOD_MODULE_SPEC.md:391` | anomaly note about the split | **CHANGE (text/annotate)** |
| `Customer_App_Production_Audit.md`, `Production_Identity.md` | historical audits citing `com.chirawa` | **KEEP as dated history** (optionally annotate "superseded by this migration") |

**Authoritative functional carriers of `com.chirawa` (the only files whose *values* gate the build):** the three `app.json` `package` fields and the three `google-services.json`. Everything else is either regenerated (`android/`), console-side, or comment text.

---

## Exact File-Change Manifest (what the Builder edits)

**Edit (6 functional + 4 text):**
1. `apps/customer-app/app.json` → `android.package = "in.bringly.customer"`; add `ios.bundleIdentifier = "in.bringly.customer"`.
2. `apps/seller-app/app.json` → `android.package = "in.bringly.seller"`; add `ios.bundleIdentifier = "in.bringly.seller"`.
3. `apps/rider-app/app.json` → `android.package = "in.bringly.rider"`; add `ios.bundleIdentifier = "in.bringly.rider"`.
4. `apps/customer-app/google-services.json` → **replace** (new download; contains `in.bringly.customer`).
5. `apps/seller-app/google-services.json` → **replace** (contains `in.bringly.seller`).
6. `apps/rider-app/google-services.json` → **replace** (contains `in.bringly.rider`).
7. `apps/customer-app/.env.example:13` → package name in comment.
8. `apps/customer-app/app.config.js` → package name in header comment.
9. `docs/PRODUCTION_READINESS_CHECKLIST.md:97,114` → package refs.
10. `docs/FOOD_MODULE_SPEC.md:391` → annotate the anomaly note.

**Delete:** root `app.json`, root `eas.json`, and (locally) `apps/customer-app/android/` before rebuild.

**Do NOT edit:** any `apps/*/eas.json` (no package inside), `app.config.js` logic (only its comment), backend, CI, notification-channel IDs, the `bringly` scheme, `AppNavigator` linking prefixes, or the `mobilesdk_app_id`/`api_key` values by hand (they arrive inside the replaced `google-services.json`).

---

## Migration Strategy

- **Config-as-source-of-truth, managed workflow.** `app.json` drives native identity; `android/` is disposable build output.
- **Reuse Firebase project; add apps.** No new project, no sender change, no backend change, no token migration.
- **One keystore, stable SHA.** Preserve the EAS Android keystore so a single SHA-1/SHA-256 registers across Firebase, Maps, and (later) App Links.
- **Big-bang across all three apps** in one pass (they share one Firebase project; partial states add risk without benefit).
- **Freeze-safe ordering:** all reversible work first (config, Firebase app regs, key, dev-client validation); the **irreversible first Play submit is the final step**, gated on a green checklist.
- **Governance ride-along (recommended):** consolidate EAS owners (`rider-app` under `aaaaaadiii`; customer/seller under `piyushlatta`) and link seller's `projectId` while credentials are already in motion.

---

## Risk Assessment

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Build ships before the matching `google-services.json` → `getDevicePushTokenAsync` fails → **no push** | Medium | **High** | Package must equal google-services `package_name` before build; validation requires a real on-device push **[device]** |
| R2 | First `eas submit` uses the wrong applicationId → **permanent** | Low | **Critical** | Submit is the last step; verify `.aab` applicationId == `in.bringly.customer` first |
| R3 | EAS mints a **new** keystore on package change → SHA drift vs Firebase/Maps/App-Links | Medium | Medium | Run `eas credentials` first; keep one keystore; capture + register SHA-1 **and** SHA-256 once |
| R4 | Maps key still restricted to old package → **blank map tiles** (customer) | High if skipped | Medium | Rotate + re-restrict to `in.bringly.customer` + SHA-1 |
| R5 | Stray root files **promoted** instead of deleted → phantom project `3c4033eb`, no Firebase/owner | Medium | High | Delete root files; edit real `apps/*/app.json`; keep real `projectId`s |
| R6 | Stale local `apps/customer-app/android/` (`com/chirawa/…`) reused → mixed-identity build | Medium | Medium | Delete `android/` then `prebuild --clean` |
| R7 | Seller build fails — no `projectId` linked | Medium | Low | `eas init`/link seller before its build |
| R8 | Someone renames `chirawa_*` channels mid-migration → server targets nonexistent channel | Low | Medium | Keep channel IDs; treat rename as a separate coordinated change (see note) |
| R9 | Firebase/Google **API key** app-restricted → new package rejected on some Google API | Low | Low | New google-services carries the key; **[console]** add new package+SHA if the key is app-restricted |
| R10 | App Links regress | N/A now | — | Not live; configure `assetlinks.json` with new package + SHA-256 when hosting is enabled |

Only R2 is irreversible, and it is fully controlled by ordering.

---

## Step-by-Step Migration Plan

> Phases 0–5 are reversible and change nothing public. Phase 6 (Play submit) is the one-way door — last, only on a green checklist.

**Phase 0 — Pre-flight [console]**
1. Play Console: confirm no app exists under `com.chirawa.*` or `in.bringly.*` (any track).
2. Expo: confirm `projectId` ownership (`db00e0a8`/`ccfa51fb`/seller-none) and the target org account for consolidation.
3. `eas credentials` per app: record keystore existence; capture **SHA-1 + SHA-256** (or plan to capture at first build if none exists yet).

**Phase 1 — Firebase (reuse project, add apps) [console]**
4. In `bringly-b71c9`, register Android apps `in.bringly.customer`, `in.bringly.seller`, `in.bringly.rider`; add release SHA-1 + SHA-256 to each.
5. Download the three new `google-services.json`.
6. (Defer) delete old `com.chirawa.*` app registrations **only after Phase 5** passes.

**Phase 2 — Repo edits (my scope on approval)**
7. Change `android.package` in all three `app.json` to `in.bringly.*`.
8. Add `ios.bundleIdentifier` = matching `in.bringly.*` (greenfield; for when iOS ships).
9. Replace the three `google-services.json` with the Phase-1 downloads.
10. Delete root `app.json` + root `eas.json`; **[console]** archive phantom Expo project `3c4033eb`.
11. Update comment/doc text (`.env.example:13`, `app.config.js` header, `PRODUCTION_READINESS_CHECKLIST.md:97,114`, `FOOD_MODULE_SPEC.md:391`).
12. **[console]** `eas init`/link seller's `projectId`; move rider to the shared org account.

**Phase 3 — Google Cloud Maps [console]**
13. Rotate the Android Maps tile key (prior audit S1) and restrict the replacement to `in.bringly.customer` + release SHA-1 + "Maps SDK for Android" only. Set as an EAS env var per profile (and local `.env` for dev-client). Seller/rider need no Maps key.

**Phase 4 — Regenerate native + internal builds**
14. Per app: delete any local `android/`/`ios/`; `expo prebuild --clean` (or rely on EAS managed prebuild). Verify generated `applicationId 'in.bringly.customer'` and Kotlin dir `…/java/in/bringly/customer/`.
15. `eas build --profile preview -p android` (internal APK) for each app.

**Phase 5 — Validation (checklist below) [device]**
16. Install all three; run the checklist. Especially: real FCM push arrives; customer map renders.

**Phase 6 — Irreversible cutover (last) [console]**
17. `eas build --profile production -p android` (app-bundle) per app; verify `.aab` applicationId.
18. Create Play apps under `in.bringly.*`; `eas submit`. **Locks the package permanently — only after Phase 5 is green.**

---

## Validation Checklist

**Repo / config**
- [ ] `grep -rn "com.chirawa" apps/*/app.json apps/*/google-services.json` → **no matches**.
- [ ] `grep -rn "in.bringly" .` (excl. node_modules, audit docs) → only the 3 `app.json`, 3 `google-services.json`, and updated comments.
- [ ] Root `app.json`/`eas.json` gone; `grep -rn "3c4033eb" .` → nothing.
- [ ] `apps/customer-app/android/` deleted before rebuild.
- [ ] `npx expo config --type public` (per app) → `in.bringly.*` package, kept `projectId`, correct display name.
- [ ] Each `google-services.json` contains a client whose `package_name` == its app's new package.

**Build / identity**
- [ ] Generated `android/app/build.gradle` → `applicationId 'in.bringly.customer'` (+ seller/rider); Kotlin dir `in/bringly/<app>/`. **[device/console]**
- [ ] Production `.aab` applicationId == `in.bringly.customer` (verify **before** submit).
- [ ] One keystore per app; SHA-1 + SHA-256 recorded and registered in Firebase + Maps. **[console]**

**Runtime (all three apps) [device]**
- [ ] Installs as `in.bringly.*` (`adb shell pm list packages | grep bringly`).
- [ ] **FCM push delivers** (order status / seller alert) — proves google-services swap + project reuse.
- [ ] Notification channels present (IDs still `chirawa_*` — expected/functional).
- [ ] Customer **map tiles render** (rotated + re-restricted key).
- [ ] `bringly://…` deep link opens the app.
- [ ] Core loop (OTP login → browse → COD checkout → tracking) works.

**Console / governance [console]**
- [ ] Play apps created under `in.bringly.*`; nothing under `com.chirawa.*`.
- [ ] Phantom Expo project `3c4033eb` archived; seller `projectId` linked; rider moved to shared org.
- [ ] (After Phase 5) old `com.chirawa.*` Firebase app registrations removed.

---

## Rollback Plan

Cheap **until Phase 6**, impossible after (which is why Phase 6 is gated and last).

- **Before first Play submit (Phases 1–5):** `git checkout -- apps/*/app.json`, restore old `google-services.json` from git history, re-restrict the Maps key to `com.chirawa.customer`, rebuild. The reused Firebase project is unharmed **provided the old `com.chirawa.*` app registrations were not yet deleted** — so defer step 6 until after Phase 5. Rollback: <1 hour.
- **Stray root files:** untracked/unstaged; if deletion is regretted, recreate from the contents in `Production_Identity.md`. **Archive, don't hard-delete,** the phantom Expo project (deletion is support-only to reverse).
- **Keystore:** back it up (and record SHAs) before any credential reassignment; loss after publish is unrecoverable.
- **After first Play submit (Phase 6):** applicationId is permanent — no rollback; treat as one-way.

---

## Estimated Effort

| Work | Effort | Owner |
|---|---|---|
| Phase 0 pre-flight (Play/EAS/keystore) | 0.25 d | Release eng [console] |
| Phase 1 Firebase: 3 app regs + SHAs + downloads | 0.5 d | Firebase [console] |
| Phase 2 repo edits (3 packages, iOS ids, google-services swap, delete strays, docs) | 0.5 d | Mobile eng |
| Phase 3 Maps rotate + re-restrict | 0.5 d | Cloud [console] |
| Phase 4 prebuild --clean + internal builds ×3 | 0.5 d | Mobile eng / EAS |
| Phase 5 device validation ×3 (FCM, maps, deep link, core loop) | 1.0 d | QA [device] |
| Phase 6 production builds + Play app creation + submit | 0.5 d | Release eng [console] |
| Governance (seller link, rider owner move, delete phantom) | 0.25 d | Release eng [console] |
| **Total** | **~3.5–4 engineer-days** (≈half console/device) | — |

Backend: **0 days**. Excludes the separate out-of-scope `api.chirawa.in` domain decision and any optional `chirawa_*` → `bringly_*` channel rebrand.

---

## Internal Verification Statement

Every category the migration touches has been traced to source and cross-checked:
- **No hidden package coupling:** the only `com.chirawa` *values* that gate a build are 3 `app.json` packages + 3 `google-services.json`; all other occurrences are regenerated native output, console-side, or comment text (full list above).
- **No backend impact:** FCM is project/token-scoped; channel IDs are a package-independent contract; no package/bundle string exists in `apps/api/src`.
- **No CI impact:** apps are not built in CI.
- **No OAuth/Analytics/Crashlytics/App-Check/App-Links migration:** none are wired today.
- **Native regenerates cleanly:** no custom native, no hardcoded package in the manifest, `android/` gitignored.

**This document is complete and self-consistent. Awaiting approval to execute Phase 2 (repo edits) — I will not touch external consoles or trigger the irreversible Play submit.**
