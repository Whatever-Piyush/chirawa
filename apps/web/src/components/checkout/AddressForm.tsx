'use client';

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CreateAddressRequest, PlacePrediction } from '@chirawa/types';
import { ApiError } from '@chirawa/api-client';
import { browserApi } from '@/lib/api/browser';
import { useDebounce } from '@/hooks/useDebounce';
import { CHIRAWA_CENTER, isServiceablePincode } from '@/lib/serviceArea';

const LABELS = ['घर', 'दुकान', 'अन्य'] as const;

// New-address form. The locality field is geo-autocompleted (Chirawa-restricted
// backend endpoint, one sessionToken per form mount as required by the geo
// service); picking a prediction resolves lat/lng + pincode via placeDetails.
// GPS ("मेरी लोकेशन") uses reverse geocoding. If neither ran, lat/lng fall back
// to the Chirawa centre — the fee engine works off coordinates, and the town
// radius is ~3 km.
export function AddressForm({
  onSaved,
  onCancel,
}: {
  onSaved: (addressId: string) => void;
  onCancel?: () => void;
}) {
  const sessionToken = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`,
  );

  const [label, setLabel] = useState<string>('घर');
  const [street, setStreet] = useState('');
  const [locality, setLocality] = useState('');
  const [landmark, setLandmark] = useState('');
  const [pincode, setPincode] = useState('333026');
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [localityFocused, setLocalityFocused] = useState(false);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedLocality = useDebounce(locality.trim(), 300);
  const { data: predictions } = useQuery({
    queryKey: ['geo-suggest', debouncedLocality],
    queryFn: () => browserApi.autocompletePlaces(debouncedLocality, sessionToken.current),
    enabled: localityFocused && debouncedLocality.length >= 3 && !coords,
    staleTime: 60_000,
  });

  const pickPrediction = async (p: PlacePrediction) => {
    setLocality(p.primaryText);
    setLocalityFocused(false);
    try {
      const d = await browserApi.placeDetails(p.placeId, sessionToken.current);
      if (d) {
        setCoords({ lat: d.lat, lng: d.lng });
        if (d.area && !p.primaryText.includes(d.area)) setLocality(`${p.primaryText}, ${d.area}`);
        if (d.pincode) setPincode(d.pincode);
      }
    } catch {
      // Prediction text stays; coords fall back to the town centre.
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setCoords({ lat, lng });
        try {
          const r = await browserApi.reverseGeocode(lat, lng);
          if (r.area) setLocality(r.area);
          if (r.street) setStreet((s) => s || r.street!);
          if (r.pincode) setPincode(r.pincode);
        } catch {
          // Coordinates are captured; text fields stay manual.
        } finally {
          setLocating(false);
        }
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const save = async () => {
    if (!street.trim() || !locality.trim()) {
      setError('गली/स्ट्रीट और मोहल्ला/एरिया ज़रूरी हैं');
      return;
    }
    if (!isServiceablePincode(pincode)) {
      setError('अभी सिर्फ़ चिरावा (पिनकोड 333026) में डिलीवरी होती है');
      return;
    }
    if (receiverPhone && !/^[6-9]\d{9}$/.test(receiverPhone)) {
      setError('रिसीवर का सही 10-अंकी नंबर डालें');
      return;
    }
    setBusy(true);
    setError(null);

    const body: CreateAddressRequest = {
      label,
      street: street.trim(),
      landmark: landmark.trim() || '-',
      locality: locality.trim(),
      city: 'Chirawa',
      pincode,
      lat: coords?.lat ?? CHIRAWA_CENTER.lat,
      lng: coords?.lng ?? CHIRAWA_CENTER.lng,
      ...(receiverName.trim() ? { receiverName: receiverName.trim() } : {}),
      ...(receiverPhone ? { receiverPhone } : {}),
    };

    try {
      const created = await browserApi.createAddress(body);
      onSaved(created.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'पता सेव नहीं हो पाया — दोबारा कोशिश करें');
    } finally {
      setBusy(false);
    }
  };

  const input =
    'w-full rounded-xl border-2 border-hairline bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-primary placeholder:text-ink-faint';

  return (
    <div className="mt-3 rounded-xl border border-hairline bg-surface-alt/50 p-3">
      <div className="flex gap-2">
        {LABELS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLabel(l)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              label === l ? 'border-primary bg-primary-light text-primary' : 'border-hairline bg-surface text-ink-muted'
            }`}
          >
            {l}
          </button>
        ))}
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="ml-auto rounded-full border border-primary bg-surface px-3 py-1 text-xs font-semibold text-primary disabled:opacity-50"
        >
          {locating ? 'ढूंढ रहे हैं…' : '📍 मेरी लोकेशन'}
        </button>
      </div>

      <div className="mt-3 space-y-2.5">
        <input
          value={street}
          onChange={(e) => setStreet(e.target.value)}
          placeholder="गली / स्ट्रीट — जैसे 5, नेहरू नगर"
          className={input}
        />

        <div className="relative">
          <input
            value={locality}
            onChange={(e) => {
              setLocality(e.target.value);
              setCoords(null); // text edited → previous pin no longer trustworthy
            }}
            onFocus={() => setLocalityFocused(true)}
            onBlur={() => setLocalityFocused(false)}
            placeholder="मोहल्ला / एरिया — जैसे पुरानी बस्ती"
            className={input}
          />
          {localityFocused && (predictions?.length ?? 0) > 0 && (
            <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-hairline bg-surface shadow-soft">
              {predictions!.slice(0, 5).map((p) => (
                <button
                  key={p.placeId}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void pickPrediction(p)}
                  className="block w-full border-b border-divider px-3 py-2 text-left last:border-b-0 hover:bg-surface-alt"
                >
                  <span className="block text-sm font-semibold text-ink">{p.primaryText}</span>
                  <span className="block truncate text-xs text-ink-muted">{p.secondaryText}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2.5">
          <input
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
            placeholder="लैंडमार्क (ऐच्छिक)"
            className={input}
          />
          <input
            value={pincode}
            onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            placeholder="पिनकोड"
            className={`${input} w-28 shrink-0`}
          />
        </div>

        <div className="flex gap-2.5">
          <input
            value={receiverName}
            onChange={(e) => setReceiverName(e.target.value)}
            placeholder="रिसीवर का नाम (ऐच्छिक)"
            className={input}
          />
          <input
            value={receiverPhone}
            onChange={(e) => setReceiverPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
            inputMode="numeric"
            placeholder="रिसीवर का नंबर"
            className={input}
          />
        </div>
      </div>

      {error && (
        <p className="mt-2 rounded-lg bg-danger-light px-3 py-2 text-xs font-semibold text-danger">{error}</p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="h-11 flex-1 rounded-xl bg-primary text-sm font-bold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {busy ? 'सेव हो रहा है…' : 'पता कन्फर्म करें'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="h-11 rounded-xl border border-hairline bg-surface px-4 text-sm font-semibold text-ink-muted"
          >
            रद्द करें
          </button>
        )}
      </div>
    </div>
  );
}
