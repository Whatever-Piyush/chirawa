import { useCallback, useEffect, useRef, useState } from 'react';
import type * as SpeechModule from 'expo-speech-recognition';

// ─── Optional native module guard ────────────────────────────────────────────
// expo-speech-recognition ships native code, so it only exists in a custom dev/
// production build — never in Expo Go, where importing it throws at load
// ("Cannot find native module 'ExpoSpeechRecognition'") and takes the whole app
// down. Load it defensively and expose `voiceSearchAvailable` so the UI can gate
// on it (mic → live sheet when present, "coming soon" toast when absent).
let speech: typeof SpeechModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  speech = require('expo-speech-recognition') as typeof SpeechModule;
} catch {
  speech = null;
}

export const voiceSearchAvailable = !!speech?.ExpoSpeechRecognitionModule;

// Cast away the optionality: every call site below sits in a try/catch, and the
// hook is only ever mounted when voiceSearchAvailable is true.
const ExpoSpeechRecognitionModule =
  speech?.ExpoSpeechRecognitionModule as typeof SpeechModule.ExpoSpeechRecognitionModule;
const useSpeechRecognitionEvent =
  speech?.useSpeechRecognitionEvent ??
  ((() => undefined) as unknown as typeof SpeechModule.useSpeechRecognitionEvent);

// ─── Voice search state machine ──────────────────────────────────────────────
// Wraps expo-speech-recognition into a small, search-focused hook: permission
// flow, start/stop/cancel, live (interim) transcript, a normalized volume level
// for the waveform, silence auto-stop, and error mapping. The UI (VoiceSearchSheet)
// stays declarative; this owns all the native plumbing.

export type VoiceStatus = 'idle' | 'listening' | 'processing' | 'error';

// 'not-allowed' is surfaced verbatim so the sheet can show a Settings prompt.
export type VoiceErrorCode = 'not-allowed' | 'no-speech' | 'no-match' | 'generic';

interface UseVoiceSearchParams {
  lang: string;                       // BCP-47, e.g. 'hi-IN' | 'en-IN'
  contextualStrings?: string[];       // catalog bias → big precision win
  requiresOnDeviceRecognition?: boolean;
  // Called once per session with the cleaned final transcript (non-empty).
  onResult: (text: string) => void;
}

interface UseVoiceSearchValue {
  status: VoiceStatus;
  transcript: string;                 // live: interim while listening, final at end
  volume: number;                     // 0..1, for the waveform
  errorCode: VoiceErrorCode | null;
  start: () => Promise<void>;
  stop: () => void;                   // manual finalize (keeps the result)
  cancel: () => void;                 // abort, discard
}

// Silence window: finalize this long after the last new words (snappy but not
// clipping mid-word). The engine also ends on its own; whichever fires first.
const SILENCE_MS = 1400;
// Hard cap so a noisy room can't keep the mic open forever.
const MAX_SESSION_MS = 12000;
// volumechange `value` is roughly -2..10 (below 0 = inaudible); map to 0..1.
const VOLUME_DIVISOR = 6;

function normalizeTranscript(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    // strip common spoken prefixes ("search for", "search", Hindi "सर्च")
    .replace(/^(search for|search|find|खोजो|सर्च)\s+/i, '')
    // trailing sentence punctuation the recognizer sometimes adds
    .replace(/[.?!,।]+$/u, '')
    .trim();
}

export function useVoiceSearch({
  lang,
  contextualStrings,
  requiresOnDeviceRecognition,
  onResult,
}: UseVoiceSearchParams): UseVoiceSearchValue {
  const [status, setStatus]       = useState<VoiceStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const [volume, setVolume]       = useState(0);
  const [errorCode, setErrorCode] = useState<VoiceErrorCode | null>(null);

  // Latest interim text + whether this session already produced a final result.
  const lastTextRef  = useRef('');
  const finalizedRef = useRef(false);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  // onResult kept in a ref so event listeners never go stale.
  const onResultRef  = useRef(onResult);
  onResultRef.current = onResult;

  const clearTimers = useCallback(() => {
    if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; }
    if (maxTimer.current)     { clearTimeout(maxTimer.current);     maxTimer.current = null; }
  }, []);

  // Commit the recognized text exactly once per session.
  const finalize = useCallback((text: string) => {
    if (finalizedRef.current) return;
    const clean = normalizeTranscript(text);
    finalizedRef.current = true;
    clearTimers();
    setVolume(0);
    if (clean.length === 0) {
      setStatus('error');
      setErrorCode('no-match');
      return;
    }
    setStatus('processing');
    onResultRef.current(clean);
  }, [clearTimers]);

  const stop = useCallback(() => {
    // Ask the engine to wrap up; the final `result`/`end` event commits the text.
    try { ExpoSpeechRecognitionModule.stop(); } catch { /* not running */ }
    // Fallback: if no final arrives shortly, finalize from the last interim.
    if (!finalizedRef.current && lastTextRef.current) {
      setTimeout(() => {
        if (!finalizedRef.current) finalize(lastTextRef.current);
      }, 350);
    }
  }, [finalize]);

  const cancel = useCallback(() => {
    finalizedRef.current = true;   // suppress any late events
    clearTimers();
    try { ExpoSpeechRecognitionModule.abort(); } catch { /* not running */ }
    setStatus('idle');
    setTranscript('');
    setVolume(0);
    setErrorCode(null);
  }, [clearTimers]);

  const armSilence = useCallback(() => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = setTimeout(() => stop(), SILENCE_MS);
  }, [stop]);

  // ── Native events ──────────────────────────────────────────────────────────

  useSpeechRecognitionEvent('start', () => {
    setStatus('listening');
  });

  useSpeechRecognitionEvent('result', (e) => {
    if (finalizedRef.current) return;
    const text = e.results?.[0]?.transcript ?? '';
    if (text) {
      lastTextRef.current = text;
      setTranscript(text);
    }
    if (e.isFinal) {
      finalize(text || lastTextRef.current);
    } else {
      armSilence();   // keep listening; reset the silence countdown
    }
  });

  useSpeechRecognitionEvent('volumechange', (e) => {
    const v = Math.max(0, Math.min(1, e.value / VOLUME_DIVISOR));
    setVolume(v);
  });

  useSpeechRecognitionEvent('nomatch', () => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    clearTimers();
    setStatus('error');
    setErrorCode('no-match');
  });

  useSpeechRecognitionEvent('error', (e) => {
    if (finalizedRef.current) return;
    // A bit of speech already captured before the timeout → use it instead of erroring.
    if ((e.error === 'no-speech') && lastTextRef.current) {
      finalize(lastTextRef.current);
      return;
    }
    finalizedRef.current = true;
    clearTimers();
    setVolume(0);
    setStatus('error');
    setErrorCode(
      e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'not-allowed'
      : e.error === 'no-speech' ? 'no-speech'
      : 'generic',
    );
  });

  useSpeechRecognitionEvent('end', () => {
    // Natural end with text but no explicit final result → finalize from interim.
    if (!finalizedRef.current && lastTextRef.current) {
      finalize(lastTextRef.current);
    }
  });

  // ── Start ────────────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    setErrorCode(null);
    setTranscript('');
    lastTextRef.current = '';
    finalizedRef.current = false;
    setStatus('listening');

    try {
      const perm = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      let granted = perm.granted;
      if (!granted) {
        const req = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        granted = req.granted;
      }
      if (!granted) {
        finalizedRef.current = true;
        setStatus('error');
        setErrorCode('not-allowed');
        return;
      }

      ExpoSpeechRecognitionModule.start({
        lang,
        interimResults: true,
        maxAlternatives: 3,
        continuous: false,
        requiresOnDeviceRecognition: requiresOnDeviceRecognition ?? false,
        addsPunctuation: false,
        contextualStrings: contextualStrings?.slice(0, 100),
        volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
      });

      if (maxTimer.current) clearTimeout(maxTimer.current);
      maxTimer.current = setTimeout(() => stop(), MAX_SESSION_MS);
    } catch {
      finalizedRef.current = true;
      setStatus('error');
      setErrorCode('generic');
    }
  }, [lang, contextualStrings, requiresOnDeviceRecognition, stop]);

  // Cleanup on unmount — never leave the mic hot.
  useEffect(() => () => {
    finalizedRef.current = true;
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    if (maxTimer.current) clearTimeout(maxTimer.current);
    try { ExpoSpeechRecognitionModule.abort(); } catch { /* noop */ }
  }, []);

  return { status, transcript, volume, errorCode, start, stop, cancel };
}
