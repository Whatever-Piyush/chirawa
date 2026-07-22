import { describe, it, expect } from 'vitest';
import { parseInventoryConfig } from '../inventory.config';
import { DEFAULT_INVENTORY_CONFIG } from '../belief';

describe('parseInventoryConfig', () => {
  it('returns pure defaults on an empty AppConfig', () => {
    expect(parseInventoryConfig([])).toEqual(DEFAULT_INVENTORY_CONFIG);
  });

  it('overrides only the keys present, per-key', () => {
    const cfg = parseInventoryConfig([
      { key: 'inv.theta_hide', value: '0.5' },
      { key: 'inv.tau.ultra', value: '4' },
    ]);
    expect(cfg.thetaHide).toBe(0.5);
    expect(cfg.classes[4]!.tauHours).toBe(4);
    expect(cfg.thetaFlag).toBe(DEFAULT_INVENTORY_CONFIG.thetaFlag);
    expect(cfg.classes[3]).toEqual(DEFAULT_INVENTORY_CONFIG.classes[3]);
  });

  it('falls back on garbage values and clamps the shop cap to [1,3]', () => {
    const cfg = parseInventoryConfig([
      { key: 'inv.k_sigma', value: 'not-a-number' },
      { key: 'inv.max_shops_per_group', value: '7' },
    ]);
    expect(cfg.kSigma).toBe(DEFAULT_INVENTORY_CONFIG.kSigma);
    expect(cfg.maxShopsPerGroup).toBe(3);
  });
});
