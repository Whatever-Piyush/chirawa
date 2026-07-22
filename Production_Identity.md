# Bringly — Production Identity & Release-Config Audit

**Date:** 2026-07-14 · **Status:** Launch-Freeze P0 · **Scope:** Application identity across the monorepo (all three Expo apps, EAS, Firebase, Maps, deep links, CI).
**Rule for this document:** audit only. No files were modified. **Recommendation stands pending your approval** — nothing is executed until you say go.
**Method:** every claim below is verified against the working tree this session (file:line / command output). Items only a console can confirm are marked **[console-verify]** rather than asserted.

---

## Executive Summary

There is **no real second identity and no migration** — there is one authoritative identity, `com.chirawa.customer`, and a pair of **stray, uncommitted files at the repo root** that declare a phantom one, `in.bringly.customer`.

The entire toolchain is wired to **`com.chirawa.*`** and has been for the whole project:

- **Firebase** (`google-services.json`, all 3 apps) registers only `com.chirawa.customer / .seller / .rider` under project `bringly-b71c9` (#559741289279). `in.bringly.customer` is registered **nowhere** — building it would break push notifications outright.
- **The tracked Expo config** (`apps/customer-app/app.json` + `app.config.js`) resolves to `com.chirawa.customer`, EAS project **`db00e0a8-…`**, owner `piyushlatta`.
- **The prebuilt `android/`** (a gitignored prebuild artifact) independently emits `applicationId 'com.chirawa.customer'`.
- **Google Maps** key restriction is documented against `com.chirawa.customer` (`.env.example`, `app.config.js`).

The drift is two files: **root `app.json` (untracked, `??`)** and **root `eas.json` (staged, `A`)**, declaring package `in.bringly.customer` and a **different, phantom EAS project `3c4033eb-…`**. They are not referenced by any app, any build script, or CI. A prior audit already caught them and labelled them "likely misplaced" (`docs/FOOD_MODULE_SPEC.md:391`).

**Decision:** Bringly permanently owns **`com.chirawa.customer`** (and `.seller`, `.rider`). The remediation is a **deletion, not a migration**: remove the two root files. Nothing in any app changes. Because **nothing has been published to Play yet** (versionCode 1 everywhere) this is still fully reversible today — but it becomes irreversible at first publish, so it must be closed inside the freeze.

> One deliberate call to confirm with you: the *brand* is "Bringly" and the *domain* is `bringly.in`, so `in.bringly.customer` is the "on-brand" reverse-DNS. This audit still recommends **keeping `com.chirawa.customer`**, because the Android **package ID is invisible to users, permanent, and already fully wired**, while the brand is already expressed by the *display name* ("Bringly"), *scheme* (`bringly`), and *domain* (`bringly.in`) — none of which depend on the package. Switching buys zero user/brand value and costs a full Firebase/Maps/EAS/assetlinks re-wire across three apps. See §Permanent Identity for the switch-cost if you overrule.

---

## Current Identity (authoritative, as wired today)

| Attribute | Value | Source (verified) |
|---|---|---|
| Display name | **Bringly** | `apps/customer-app/app.json` `name` |
| Slug | `bringly-customer` | same |
| Android package | **`com.chirawa.customer`** | `app.json` + `android/app/build.gradle:90,92` (`namespace`/`applicationId`) |
| iOS bundle ID | **none set** (`ios: {}`) | `app.json` — iOS unconfigured (Android-first launch) |
| Expo project ID | **`db00e0a8-c8c7-4d48-9e59-b032891ce81b`** | `app.json` `extra.eas.projectId` |
| Expo owner | `piyushlatta` | `app.json` `owner` |
| URL scheme | `bringly` (+ `exp+bringly-customer`) | `app.json` / `AndroidManifest:40–41` |
| Deep-link domains | `bringly://`, `https://bringly.in`, `https://www.bringly.in` | `AppNavigator.tsx:128` |
| Firebase project | `bringly-b71c9` (#559741289279) | `google-services.json` |
| versionCode / versionName | `1` / `1.0.0` | `app.json`, `build.gradle:95–96` → **nothing published yet** |
| Dynamic config | `app.config.js` spreads `app.json`, injects only the Android Maps key | `app.config.js` |

**Sibling apps (consistent, same Firebase project):**

| App | Package | Expo project | Owner |
|---|---|---|---|
| Seller | `com.chirawa.seller` | (none in app.json) **[console-verify]** | `piyushlatta` |
| Rider | `com.chirawa.rider` | `ccfa51fb-…` | **`aaaaaadiii`** ⚠️ different account |

---

## Detected Drift

| # | File | Git state | Declares | Verdict |
|---|---|---|---|---|
| D1 | **`/app.json`** (repo root) | **untracked** (`??`) | package `in.bringly.customer`, projectId `3c4033eb-…`; no owner, no slug, no `google-services`, no version | **Stray — delete** |
| D2 | **`/eas.json`** (repo root) | **staged** (`A`, not committed) | generic profiles, `appVersionSource: "remote"`, `cli >= 20.5.1` | **Stray — delete/unstage** |

Distinguishing details that prove D1/D2 are phantom, not authoritative:

- The root files are **minimal generated stubs** (no owner, no `googleServicesFile`, no scheme, no plugins) — the shape `eas init` produces on first run, not a maintained config.
- Root `eas.json` uses `appVersionSource: "remote"` and `cli >= 20.5.1`; the **real** app config (`apps/customer-app/eas.json`) uses `"local"` and `>= 16.0.0` with proper `app-bundle`/`apk` build types — i.e., the root file was generated by a *newer* CLI in a *different* invocation.
- The root **`package.json` is `name: "chirawa"`, private, with zero Expo/React-Native deps** — the repo root is **not an Expo app**, so its `app.json`/`eas.json` have no legitimate purpose.
- The phantom projectId `3c4033eb-…` appears in **no** app and no `.env`, docs, or CI.
- `in.bringly.customer` / `in.bringly` appears only in: the stray root `app.json`, the prior audit's anomaly note (`docs/FOOD_MODULE_SPEC.md:391`), and this document. **Zero functional wiring.**

---

## Root Cause

**Almost certainly an `eas` command run from the monorepo root instead of from `apps/customer-app`.** When EAS CLI runs in a directory with no Expo project, it offers to initialise one — generating an `app.json` (new project ID `3c4033eb-…`) and an `eas.json`, and prompting for/guessing an Android package. Someone entered/accepted **`in.bringly.customer`** (the reverse of the brand domain `bringly.in`), creating a *second* Expo project that points at nothing real.

Corroboration: a newer EAS CLI signature (`>= 20.5.1`, `appVersionSource: remote`) than the app's committed config; the untracked/partially-staged state (created ad-hoc, never intended as source); and the independent prior-audit note calling it "likely misplaced." **This is not a brand rename that was carried out** — a real rename would have re-registered Firebase, regenerated `google-services.json` for the new package, updated `app.config.js`/Maps restriction, and left a doc. None exists.

---

## Determinations (answers to Q1–Q17)

| # | Question | Answer |
|---|---|---|
| 1 | Which config is authoritative? | `apps/customer-app/app.config.js` → which spreads `apps/customer-app/app.json`. (Dynamic config wins in Expo; here it only adds the Maps key.) |
| 2 | Why are two identities present? | A stray `eas init`/`eas build` run from the repo root generated a phantom project (root `app.json`/`eas.json`, `in.bringly.customer`, `3c4033eb`). |
| 3 | Is this intentional? | **No.** Untracked/partially-staged, unwired, and already flagged "likely misplaced" by a prior audit. |
| 4 | Was a migration started? | **No.** No Firebase re-registration, no new `google-services.json`, no config/Maps/EAS/assetlinks changes, no doc. |
| 5 | Which **Android package** should Bringly own? | **`com.chirawa.customer`** (+ `.seller`, `.rider`). |
| 6 | Which **iOS bundle ID**? | Greenfield (none set anywhere). Recommend **`com.chirawa.customer`** to mirror Android; decide now so Firebase-iOS can be registered when iOS ships. |
| 7 | Which **Expo project ID** survives? | **`db00e0a8-…`** (customer). Abandon phantom `3c4033eb-…`. |
| 8 | What files must change? | Delete root `app.json`; delete/unstage root `eas.json`. Nothing else for the P0. |
| 9 | What files must NOT change? | `apps/customer-app/{app.json, app.config.js, eas.json}`, every `google-services.json`, the gitignored `android/`, seller/rider configs. |
| 10 | Can existing **Firebase** continue? | **Yes**, unchanged — `com.chirawa.*` stays registered under `bringly-b71c9`. (Would have **broken** under `in.bringly.customer`.) |
| 11 | Can **Google Maps** continue? | **Yes** — key is/should be restricted to `com.chirawa.customer` + release SHA-1; no package change means no re-restriction. **[console-verify]** the key is rotated + restricted. |
| 12 | Will **Play Integrity** still work? | **Yes** — not yet published (versionCode 1), so Play App Signing identity isn't locked. Publishing under `com.chirawa.customer` keeps the toolchain aligned. **[console-verify]** nothing already published under either ID. |
| 13 | Will existing **deep links** still work? | **Yes** — scheme `bringly` and domain `bringly.in` are **package-independent**. (App-Links verification via `assetlinks.json` must list `com.chirawa.customer` + signing SHA — ensure it does.) |
| 14 | Will existing **OAuth** continue? | **N/A / Yes** — auth is phone-OTP (Fast2SMS), not Google OAuth; no OAuth client is bound to the package. |
| 15 | Will **notifications** continue? | **Yes** — FCM sender `559741289279` with `com.chirawa.customer` registered. (Would **break** under `in.bringly.customer`: no FCM client.) |
| 16 | Will **OTA updates** continue? | Not configured yet (no `updates`/`runtimeVersion` block). When added, they bind to project `db00e0a8-…`; the phantom `3c4033eb-…` must not be used. |
| 17 | Will existing **EAS builds** break? | **No** — real builds target `db00e0a8-…` from `apps/customer-app`. The only risk is an accidental build **from the repo root** hitting the phantom project; deleting the root files removes that risk entirely. |

---

## Permanent Identity (the decision)

**Own these, permanently:**

| Surface | Android package | iOS bundle ID (when iOS ships) | Firebase | EAS project |
|---|---|---|---|---|
| Customer | `com.chirawa.customer` | `com.chirawa.customer` | `bringly-b71c9` | `db00e0a8-…` (owner `piyushlatta`) |
| Seller | `com.chirawa.seller` | `com.chirawa.seller` | `bringly-b71c9` | link/confirm **[console-verify]** |
| Rider | `com.chirawa.rider` | `com.chirawa.rider` | `bringly-b71c9` | `ccfa51fb-…` (owner `aaaaaadiii` ⚠️) |

**Why `com.chirawa.*` and not `in.bringly.*`:** the package ID is invisible to users and permanent; it is already the *only* identity registered in Firebase, produced by prebuild, referenced by the Maps restriction, and linked to the live EAS project. The brand "Bringly" is fully carried by the display name, `bringly` scheme, and `bringly.in` domain — all independent of the package. Switching delivers no user-facing or brand value.

**If you overrule and require `in.bringly.customer`** (a legitimate brand call, but it must be made *now*, pre-publish, and executed across all surfaces): it becomes a real migration, not a delete — register `in.bringly.*` in Firebase for **all three** apps, download fresh `google-services.json` ×3, re-restrict the Maps key to the new package + SHA-1, decide whether to keep `db00e0a8` or adopt the phantom `3c4033eb`, update `app.json` package + prebuild, and update `assetlinks.json`. For consistency you'd also rename seller/rider. This is a multi-day cross-surface change; do **not** do it piecemeal, and do **not** do it after any Play publish.

---

## Migration Plan (remediation — deletion, not migration)

Small and low-risk *because* it's a cleanup. Steps are stated for approval; **not executed**.

1. **Confirm nothing is published** under either `com.chirawa.customer` or `in.bringly.customer` on Play (any track) and that phantom Expo project `3c4033eb-…` holds no builds you need. **[console-verify]**
2. **Delete `/app.json`** (root, untracked).
3. **Unstage and delete `/eas.json`** (root) — `git rm --cached eas.json` then remove, or discard the add.
4. **Add a guard** so this can't recur: a root `.gitignore` entry and/or a root `package.json` `preinstall`/`eas`-wrapper note that EAS commands must run from `apps/*`. (Optional but recommended; separate small change.)
5. **Archive/delete the phantom EAS project** `3c4033eb-…` in the Expo dashboard so no one targets it. **[console-verify]**
6. **Governance follow-up (not a launch blocker):** move `rider-app` off the personal `aaaaaadiii` account onto the same org/owner as customer+seller, so all three ship under one Expo org with shared credentials. **[console-verify]**

No app-level file changes. No rebuild required for the P0 itself (the app configs are already correct).

---

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Build cut from repo root → ships `in.bringly.customer` / phantom project | Medium (until deleted) | **Critical** (wrong permanent package, no Firebase/Maps) | Delete root files (steps 2–3); add guard (step 4) |
| Someone "fixes" the split by switching apps to `in.bringly.*` | Medium | **Critical** (breaks push; needs full re-wire) | This doc's decision + §Permanent Identity switch-cost |
| First Play publish under the wrong ID | Low now / **irreversible** at publish | **Critical** | Close P0 inside freeze; step 1 gate before any submit |
| Maps key not yet rotated/restricted (prior known compromise) | Unknown | High (quota theft / blank tiles) | **[console-verify]** rotate + restrict to `com.chirawa.customer` + SHA-1 |
| Rider app under a personal Expo account | Confirmed | Medium (bus-factor, credential access) | Governance step 6 |
| Deletion removes a file someone did want | Low | Low | Files are untracked/unstaged & unwired; Rollback below restores in seconds |

---

## Rollback Plan

The remediation is trivially reversible (this is why it's safe to do under freeze):

- The root files are **untracked/unstaged**, so deleting them touches no git history. To restore, recreate the two files (contents captured verbatim in this document's history/console output) — or, since they're phantom, simply re-run the erroneous `eas init` from root (not advised).
- No app config, Firebase, Maps, or EAS project is altered by the remediation, so there is **nothing to roll back** on those surfaces.
- If step 5 (delete phantom Expo project) is later regretted, Expo project deletion is reversible only via Expo support — therefore **archive first, delete later**, and only after step 1 confirms it holds nothing needed.

---

## Files To Modify

| File | Action | Git state today |
|---|---|---|
| `/app.json` | **Delete** | untracked (`??`) |
| `/eas.json` | **Delete / unstage** | staged (`A`) |
| `/.gitignore` (root) | *(optional)* add guard against re-creating root `app.json`/`eas.json` | tracked |

## Files To Leave Untouched

- `apps/customer-app/app.json` — the authoritative identity. **Do not edit.**
- `apps/customer-app/app.config.js` — correct; only injects the Maps key. **Do not edit.**
- `apps/customer-app/eas.json` — the real, correct EAS profiles. **Do not edit.**
- `apps/customer-app/android/**` — gitignored prebuild artifact; regenerates from `app.json`. Leave as-is.
- `apps/customer-app/google-services.json` and the seller/rider copies — Firebase truth for `com.chirawa.*`. **Do not edit.**
- `apps/seller-app/*` and `apps/rider-app/*` identity configs — consistent; out of scope for the P0 (except the governance account move).

## Post-Migration Validation Checklist

**Repo / config**
- [ ] `git status` shows root `app.json` and `eas.json` gone; working tree otherwise unchanged.
- [ ] `grep -rn "in.bringly" .` (excl. node_modules & this doc & the prior-audit note) returns **nothing**.
- [ ] `grep -rn "3c4033eb" .` returns **nothing**.
- [ ] `npx expo config --type public` **run from `apps/customer-app`** shows package `com.chirawa.customer`, projectId `db00e0a8-…`, name "Bringly".
- [ ] Running any `expo`/`eas` command from the **repo root** now errors (no root Expo project) rather than silently using a phantom identity.

**Build / identity**
- [ ] `eas build --profile production -p android` from `apps/customer-app` produces an `.aab` with `applicationId com.chirawa.customer`, targeting project `db00e0a8-…`. **[console-verify]**
- [ ] The resulting build's `google-services.json` package matches (`com.chirawa.customer`).

**Runtime (device smoke)**
- [ ] App installs with package `com.chirawa.customer` (`adb shell pm list packages | grep chirawa`).
- [ ] FCM push (order status) delivers on the build. **[device-validate]**
- [ ] Android map tiles render (Maps key rotated + restricted to package + SHA-1). **[console-verify + device]**
- [ ] Deep link `bringly://…` and `https://bringly.in/…` open the app (App-Links: `assetlinks.json` lists `com.chirawa.customer` + release SHA). **[console-verify]**

**Console / governance**
- [ ] Nothing published to Play under either ID; first submission (when made) uses `com.chirawa.customer`. **[console-verify]**
- [ ] Phantom Expo project `3c4033eb-…` archived/deleted. **[console-verify]**
- [ ] Rider app moved to the shared org account (was `aaaaaadiii`). **[console-verify]**

---

**Awaiting approval.** On your go, I will execute only the §Files-To-Modify deletions (plus the optional `.gitignore` guard) and nothing else. The console/governance items are yours to action or delegate; I will not touch Expo/Firebase/Google/Play dashboards.
