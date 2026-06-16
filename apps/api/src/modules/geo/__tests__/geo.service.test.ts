import { describe, it, expect } from 'vitest';
import { parseGoogleResults, isPlusCode } from '../geo.service';

describe('isPlusCode', () => {
  it('flags Open Location Codes and ignores normal text', () => {
    expect(isPlusCode('6JVX+3C')).toBe(true);
    expect(isPlusCode('6JVX+3C, Shyampura')).toBe(true);
    expect(isPlusCode('Shyampura')).toBe(false);
    expect(isPlusCode('Purani Basti')).toBe(false);
    expect(isPlusCode(null)).toBe(false);
  });
});

describe('parseGoogleResults', () => {
  it('drops Plus-Code-only results and extracts a real locality + pincode', () => {
    // Mirrors the bug in ss/1.jpeg: the first result is a Plus Code, the second
    // carries the real components.
    const out = parseGoogleResults([
      {
        formatted_address: '6JVX+3C Shyampura, Rajasthan, India',
        types: ['plus_code'],
        address_components: [
          { long_name: '6JVX+3C', short_name: '6JVX+3C', types: ['plus_code'] },
        ],
      },
      {
        formatted_address: 'Shyampura, Chirawa, Rajasthan 333026, India',
        types: ['sublocality', 'political'],
        address_components: [
          { long_name: 'Shyampura',  short_name: 'Shyampura',  types: ['sublocality_level_1', 'sublocality', 'political'] },
          { long_name: 'Chirawa',    short_name: 'Chirawa',    types: ['locality', 'political'] },
          { long_name: 'Jhunjhunu',  short_name: 'Jhunjhunu',  types: ['administrative_area_level_2', 'political'] },
          { long_name: 'Rajasthan',  short_name: 'RJ',         types: ['administrative_area_level_1', 'political'] },
          { long_name: '333026',     short_name: '333026',     types: ['postal_code'] },
        ],
      },
    ]);

    expect(out.area).toBe('Shyampura');
    expect(out.city).toBe('Chirawa');
    expect(out.state).toBe('Rajasthan');
    expect(out.pincode).toBe('333026');
    expect(out.source).toBe('google');
    // formatted must not start with the Plus Code token.
    expect(isPlusCode(out.formatted ?? '')).toBe(false);
  });

  it('returns source "none" when only a Plus Code is available', () => {
    const out = parseGoogleResults([
      {
        formatted_address: '6JVX+3C',
        types: ['plus_code'],
        address_components: [{ long_name: '6JVX+3C', short_name: '6JVX+3C', types: ['plus_code'] }],
      },
    ]);
    // Only the Plus Code result exists → pool falls back to it, but the area is a
    // Plus Code so it's nulled out; nothing usable remains.
    expect(out.area).toBeNull();
    expect(out.source).toBe('none');
  });

  it('uses route for street and prefers sublocality for area', () => {
    const out = parseGoogleResults([
      {
        formatted_address: 'Nehru Marg, Purani Basti, Chirawa 333026',
        types: ['route'],
        address_components: [
          { long_name: 'Nehru Marg',   short_name: 'Nehru Marg',   types: ['route'] },
          { long_name: 'Purani Basti', short_name: 'Purani Basti', types: ['sublocality_level_1', 'sublocality'] },
          { long_name: 'Chirawa',      short_name: 'Chirawa',      types: ['locality'] },
          { long_name: '333026',       short_name: '333026',       types: ['postal_code'] },
        ],
      },
    ]);
    expect(out.street).toBe('Nehru Marg');
    expect(out.area).toBe('Purani Basti');
  });
});
