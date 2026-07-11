# Voice Search — Plan (✅ CODE COMPLETE — pending native dev-client rebuild)

> Status: all JS/TS, the `expo-speech-recognition` config plugin, deps, and i18n
> are implemented and typecheck-clean. The **only** remaining step is rebuilding
> the Android dev client so the native module ships in the binary:
> `eas build --profile development --platform android` (needs the Expo account).
> Voice will not work on the *old* dev build until that new build is installed.

Goal: add a **voice search** to the customer app that feels exactly like the
voice mic in **Blinkit / Google / Amazon** — tap the mic, a clean listening
sheet animates up, your words appear live as you speak, it auto-stops on
silence, and the search runs instantly with high accuracy. Built for **maximum
precision** on our actual catalog (Hindi-first grocery terms) — not a generic
dictation box.

> Scope note: this is **client-only**. Voice produces *text*, which feeds the
> existing search pipeline (`/search`). No backend/API changes required.

---

## 1. Current state (what we build on)

- `apps/customer-app/src/screens/search/SearchScreen.tsx` — the full search UX:
  - One rectangular search field (`TextInput`, `inputRef`) with a back chevron
    and a clear (×) button.
  - `handleQueryChange(text)` — live typing → debounced `runSearch` + `fetchSuggest`.
  - `fireQuery(term)` — **commits** a query (sets text, closes the dropdown,
    runs the search). **This is the exact hook voice will call** with the final
    transcript.
  - Server autocomplete dropdown, category chips, filter sheet, recent searches.
- App is on **Expo SDK 54** with **`expo-dev-client`** → we ship **custom dev
  builds**, so a native speech module with a config plugin is fully supported
  (same pattern already used by `expo-location`, `expo-contacts`,
  `expo-notifications` in `app.json`).
- App is **bilingual (Hindi/English)** via `@chirawa/i18n` (`useT`), and the
  catalog is **Hindi-first** — product names are Devanagari (आलू, प्याज, दूध,
  साबुन…). Accurate Hindi recognition is the core of "precision" here.

---

## 2. Reference behavior (what "like big tech" means)

What we will match, concretely:

1. **Mic affordance** inside the search field (right side), like Google/Amazon.
2. **Tap → listening sheet** slides up with a large **pulsing mic + live
   waveform/volume animation** (Google-style) and a "Listening…" prompt.
3. **Live partial transcript** — words appear *as you speak* (interim results),
   greying then finalizing — the single most "premium" feeling detail.
4. **Auto-stop on silence** (~1.2–1.6s of no new speech) → finalize.
5. **Auto-run search** with the final transcript (no extra tap), landing the
   user straight on results. Field shows the recognized text.
6. **Graceful states**: permission prompt, "Didn't catch that / try again",
   no-match, offline, mic-in-use, and a manual **Tap to stop** + **Cancel**.
7. **Haptics** on start/stop, subtle sound-free polish, dismiss by tap-outside.
8. **Language aware** — recognizes Hindi *and* English (Hinglish reality of our
   users) and feeds Devanagari/Latin text the catalog already indexes.

---

## 3. Library choice

**Chosen: `expo-speech-recognition` (jamsch), `@sdk-54` tag.**

- Native STT: iOS `SFSpeechRecognizer`, Android `SpeechRecognizer` (Google).
- Config-plugin based (adds permissions + Android package visibility) → matches
  our existing plugin workflow; needs a **new dev build** (see §8).
- Exposes everything we need for precision + UX:
  - `ExpoSpeechRecognitionModule.start({ lang, interimResults, continuous,
    requiresOnDeviceRecognition, contextualStrings, maxAlternatives, … })`
  - `requestPermissionsAsync()` / `getPermissionsAsync()`
  - `useSpeechRecognitionEvent(name, cb)` events: `start`, `audiostart`,
    `result` (has `results[]` + `isFinal`), `volumechange` (waveform!),
    `audioend`, `end`, `error` (`error` code + `message`).
  - `getSupportedLocales()` + Android offline model download helper.
- Install pinned to SDK 54: `npm install expo-speech-recognition@sdk-54`.

**Alternatives considered (and why not):**
- `@react-native-voice/voice` — works, but not Expo-config-plugin-native; rougher
  partial-results + locale story; weaker biasing. Rejected for precision/DX.
- `expo-speech` — that's **text-to-speech only** (output), not recognition.
- Cloud STT (Google/Whisper API) — highest ceiling, but adds latency, cost, a
  backend audio pipeline, and privacy surface. **Overkill** for short search
  utterances; on-device/native is faster and free. Keep as a *future* option.

---

## 4. Architecture & data flow

```
[Mic button in SearchScreen field]
        │ tap
        ▼
[useVoiceSearch() hook]  ──(permission?)──►  request / route to Settings
        │ granted
        ▼
ExpoSpeechRecognitionModule.start({ lang, interimResults:true,
    contextualStrings:<catalog bias>, maxAlternatives:3 })
        │
        ├─ event "volumechange" ─► drive waveform animation
        ├─ event "result" (interim) ─► live transcript in the sheet + (optional) field
        ├─ silence timer (debounce on interim) ─► stop()
        └─ event "result" (isFinal) / "end" ─► finalTranscript
                                  │
                                  ▼
                       normalize(finalTranscript)
                                  │
                                  ▼
                  SearchScreen.fireQuery(finalTranscript)   ← existing function
                                  │
                                  ▼
                     existing /search pipeline → results
```

- **New hook** `useVoiceSearch` encapsulates: permission, start/stop, state
  machine (`idle | listening | processing | error`), interim+final transcript,
  volume level, silence auto-stop, and cleanup. SearchScreen stays thin.
- **New component** `VoiceSearchSheet` (pure RN `Modal` + `Animated`, **no extra
  native dep**) renders the listening UI and calls back with the final text.
- SearchScreen change is minimal: render a mic button → open sheet → on final
  transcript call the **existing** `fireQuery`.

---

## 5. UX spec (states & copy)

**Mic button** (in the field): show when query is empty (Google/Amazon pattern);
when there's text, the × clear button takes that slot. Mic uses
`Ionicons name="mic-outline"`, primary tint.

**Listening sheet** (centered modal / bottom sheet, dimmed backdrop):
- `idle→listening`: big circular mic, **pulsing ring** + **volume-reactive
  waveform** bars driven by `volumechange`. Title: "Listening…", subtitle:
  "अभी बोलिए" / "Speak now". Haptic light-impact on open.
- live **interim transcript** under the mic (greyed), finalizes to solid.
- **Tap to stop** (manual finalize) + **Cancel** (dismiss, no search).
- `processing`: brief spinner / "..." while finalizing.
- `error`/no-match: "सुनाई नहीं दिया, फिर कोशिश करें" / "Didn't catch that —
  tap to try again" with a retry mic.
- `permission denied`: explainer + "Open Settings" (Linking) button.
- On **final** transcript: close sheet, set field text, run search, light haptic.

**Language control:** a small **हिं / EN toggle** (or "Auto") in the sheet so a
user can force Hindi vs English if needir — defaults per §6.

---

## 6. Precision strategy (the core ask)

The accuracy levers, in priority order:

1. **Domain biasing via `contextualStrings`** — seed recognition with our actual
   vocabulary so it favors grocery words over generic homophones. Build the bias
   list at sheet-open from: live **category names** (`fetchCategories`), the
   **popular chips** (`POPULAR_CHIPS`), and top **product names** (cached feed) —
   capped (~80–100 strings) to stay performant. This is the biggest single win.
2. **Right locale** — default `lang` to the app's current i18n language:
   `hi-IN` for Hindi UI, `en-IN` for English (Indian-English acoustic model, not
   `en-US`). Honor the in-sheet हिं/EN toggle override.
3. **Interim + alternatives** — `interimResults:true` for live feel;
   `maxAlternatives:3`, then pick the best alternative that yields search hits
   (re-rank by catalog match when the top pick returns nothing).
4. **Transcript normalization** — trim, collapse whitespace, strip trailing
   punctuation/filler ("उम्म", "search for"), keep Devanagari intact.
5. **Silence auto-stop tuning** — finalize ~1.3s after the last interim so users
   aren't cut off mid-word but it still feels instant.
6. **Android offline model** — optionally trigger `hi-IN` offline model download
   so recognition works without network and lower latency (graceful if absent).
7. **(Future) cloud STT escalation** — if on-device confidence is low twice,
   could fall back to a server Whisper/Google call. Out of scope v1; noted.

No backend change needed for any of v1's levers.

---

## 7. i18n keys (new)

Add to `packages/i18n/src/translations.ts` (EN + HI), e.g.:
`voice.listening`, `voice.speakNow`, `voice.tapToStop`, `voice.cancel`,
`voice.processing`, `voice.noMatch`, `voice.tryAgain`, `voice.permTitle`,
`voice.permBody`, `voice.openSettings`, `voice.langHindi`, `voice.langEnglish`.

---

## 8. Permissions & native rebuild (operational cost — read this)

- Add the plugin to `app.json` with Hindi-friendly permission copy:
  ```json
  ["expo-speech-recognition", {
    "microphonePermission": "Bringly aapki aawaz se search karne ke liye microphone use karti hai.",
    "speechRecognitionPermission": "Bringly aapki aawaz ko text mein badalne ke liye speech recognition use karti hai.",
    "androidSpeechServicePackages": ["com.google.android.googlequicksearchbox"]
  }]
  ```
- iOS: adds `NSMicrophoneUsageDescription` + `NSSpeechRecognitionUsageDescription`.
- Android: adds `RECORD_AUDIO` + `<queries>` visibility for Google's recognizer.
- **A new native module + plugin means the current dev build won't have it.** We
  must rebuild the dev client (`eas build --profile development` or
  `npx expo run:android` / `run:ios`) and reinstall before voice works. The JS in
  the running Metro can't load a native module that isn't in the binary. **This
  is the one unavoidable step** — flagged up front.

---

## 9. Files to touch

| File | Change |
|------|--------|
| `apps/customer-app/package.json` | add `expo-speech-recognition@sdk-54` |
| `apps/customer-app/app.json` | add the plugin block (permissions) |
| `apps/customer-app/src/hooks/useVoiceSearch.ts` | **new** — permission + STT state machine + biasing + silence auto-stop |
| `apps/customer-app/src/components/search/VoiceSearchSheet.tsx` | **new** — listening modal (mic pulse, waveform, transcript, states) |
| `apps/customer-app/src/screens/search/SearchScreen.tsx` | mic button in field → open sheet → on final call `fireQuery`; pass catalog bias + locale |
| `packages/i18n/src/translations.ts` | new `voice.*` keys (EN + HI) |
| *(optional v2)* Home search bar | mic that opens Search and auto-starts listening |

---

## 10. Phased implementation

- **Phase 0 — Native enablement:** install lib, add plugin + permission copy,
  rebuild dev client, verify `requestPermissionsAsync` + a bare `start()` logs a
  transcript on device. (Gate: voice works at all.)
- **Phase 1 — Hook:** `useVoiceSearch` — permission flow, start/stop, events,
  interim/final transcript, volume level, silence auto-stop, error mapping.
- **Phase 2 — Sheet UI:** `VoiceSearchSheet` with mic pulse + waveform +
  live transcript + all states + haptics + i18n copy.
- **Phase 3 — Wire into SearchScreen:** mic button, open sheet, final →
  `fireQuery`; locale = app language; build `contextualStrings` from
  categories/popular/feed.
- **Phase 4 — Precision pass:** alternatives re-ranking, normalization, silence
  tuning, optional Android offline model; test Hindi + English + Hinglish on a
  real device.
- **Phase 5 — Polish:** typecheck, edge cases (deny→settings, mic busy, rapid
  re-tap), optional Home-bar mic entry point.

---

## 11. Security & privacy

- Mic + speech permission requested **only on first mic tap**, with clear Hindi
  copy; denial routes to Settings, never nags.
- **No audio is recorded or uploaded** — recognition is on-device/native; we keep
  only the resulting *text*. Offer `requiresOnDeviceRecognition` where available
  for a fully on-device path.
- No new network endpoint, no new input the backend trusts → **no new attack
  surface**. Transcript flows through the same sanitized `/search` path as typed
  queries.

---

## 12. Acceptance criteria

- Tap mic → listening sheet with live waveform + interim words; auto-stops on
  silence; search runs automatically with the recognized text.
- Recognizes common **Hindi** grocery terms (आलू/प्याज/दूध/चीनी/तेल) and
  **English** terms accurately on a real device, biased by our catalog.
- Permission deny, no-match, offline, and cancel are all handled cleanly.
- No regressions to typed search; customer-app typecheck passes.
- Feels as smooth as Blinkit/Google/Amazon voice (subjective bar, device-tested).

---

## 13. Open decisions (please confirm before we build)

1. **Default language:** follow the app's current i18n language (recommended) and
   offer a हिं/EN toggle in the sheet — or hard-default to `hi-IN`?
2. **Listening UI shape:** centered modal with pulsing mic + waveform
   (recommended, Google-style) — or a bottom sheet?
3. **Auto-run vs confirm:** auto-run the search on final transcript (recommended,
   Blinkit-style) — or show the text and let the user tap search?
4. **Entry points:** SearchScreen mic only for v1 (recommended) — or also add a
   mic to the Home search bar that deep-links + auto-starts?
5. **On-device-only mode:** prefer `requiresOnDeviceRecognition` for privacy/
   latency where supported (recommended) — or allow network recognition for
   best accuracy?
6. **Dev build:** OK to rebuild the dev client now (required), and do you want
   me to run `expo run:android`/`eas build`, or will you trigger the build?
