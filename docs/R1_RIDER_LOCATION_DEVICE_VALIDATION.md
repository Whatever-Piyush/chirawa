# R1 — Rider Location: Real-Device Validation Checklist

**Why this exists:** Milestone R1 (rider live location + assignment honesty) is
code-complete and its socket contract is proven by an automated E2E. But that E2E
used a *simulated* publisher — it never ran `expo-location`. The milestone's core
promise (location keeps flowing while the rider navigates in Google Maps) can only
be confirmed on a **real Android device running an EAS dev/preview build** — it does
NOT work in Expo Go, and there is no emulator path for the foreground service.

Do not mark R1 "done" or claim "customer sees live rider on the map" until every
row below passes on a physical device.

---

## Build

- [ ] Build a rider-app **dev or preview** EAS build (not Expo Go):
      `eas build -p android --profile preview` (or `development`).
- [ ] Install on a real Android phone with a SIM + GPS (a mid/low-end device that
      matches the fleet, not a flagship — battery/throttle behavior differs).
- [ ] Have a second device (or the simulator) running the **customer app** on the
      same order, plus a way to move (walk/drive) the rider phone.

## Core continuation test (THE gate)

- [ ] Rider online + one assigned order in the Delivery tab.
- [ ] Grant location permission when prompted → **"while using the app"** only.
      (Confirm the OS dialog does NOT ask for "all the time"/background.)
- [ ] Foreground: rider moves → customer tracking map marker moves within ~10s.
- [ ] **Tap "Navigate" → Google Maps opens (our app backgrounds).** Keep moving.
      → Customer marker KEEPS updating. A persistent "Bringly delivery chalu hai"
      notification is visible. ← *If the marker freezes here, R1 has failed its
      purpose; escalate — do not ship the map.*
- [ ] Return to the rider app → marker still live, no duplicate service/notification.
- [ ] Complete delivery (cod-collected) → customer sees NO further location updates.
- [ ] Go offline (Home toggle) while a batch is active → emits stop; notification clears.
- [ ] Swipe the rider app away → foreground-service notification disappears
      (`killServiceOnDestroy`), no ghost service in system settings.

## Permission matrix

- [ ] **Granted:** as above.
- [ ] **Denied at prompt:** delivery actions (Reached / Picked up / Delivered /
      Call / Navigate / COD) all still work; the warning banner shows and taps
      through to Settings.
- [ ] **Revoked mid-batch** (Settings → revoke while an order is live): app doesn't
      crash; banner appears; deliveries still completable. Re-grant + return to app
      → publishing resumes (AppState "active" retry).

## Battery / behavior sanity (one real shift, informal)

- [ ] Run one real delivery run; confirm no runaway battery drain and the service
      survives a screen-off period during navigation.

## Play Console (submission-time, not now)

- [ ] Foreground-service-location **prominent disclosure** form + justification
      prepared for the next Android submission (the binary now ships
      `FOREGROUND_SERVICE_LOCATION`). Missing this = store rejection.

---

**Owner:** _(founder — needs the physical device)_
**Result / date:** ____________________
**Sign-off:** R1 is launch-ready only when the Core continuation test passes.
