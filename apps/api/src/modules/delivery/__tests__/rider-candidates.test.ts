import { describe, it, expect, vi } from 'vitest';
import { loadRiderCandidates, pickBestRider } from '../dispatch.service';

// P1-11 regression tests: candidate loading must be O(1) queries, not
// 2 per online rider (100 riders used to mean ~200 queries per assignment).

function makePrisma(
  profiles: Array<{ id: string; userId: string }>,
  activeCounts: Array<{ riderId: string; _count: { _all: number } }>,
) {
  return {
    riderProfile:       { findMany: vi.fn().mockResolvedValue(profiles) },
    deliveryAssignment: { groupBy: vi.fn().mockResolvedValue(activeCounts) },
  };
}

describe('loadRiderCandidates (P1-11)', () => {
  it('issues exactly TWO queries regardless of rider count', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `rp${i}`);
    const p = makePrisma(ids.map((id) => ({ id, userId: `u-${id}` })), []);

    const candidates = await loadRiderCandidates(p as never, ids);

    expect(candidates).toHaveLength(100);
    expect(p.riderProfile.findMany).toHaveBeenCalledTimes(1);       // was 100 findUnique
    expect(p.deliveryAssignment.groupBy).toHaveBeenCalledTimes(1);  // was 100 count
    expect(p.riderProfile.findMany).toHaveBeenCalledWith({
      where: { id: { in: ids } }, select: { id: true, userId: true },
    });
    expect(p.deliveryAssignment.groupBy).toHaveBeenCalledWith({
      by: ['riderId'], where: { riderId: { in: ids }, isActive: true }, _count: { _all: true },
    });
  });

  it('maps active counts per rider and defaults missing riders to 0', async () => {
    const p = makePrisma(
      [{ id: 'rp1', userId: 'u1' }, { id: 'rp2', userId: 'u2' }],
      [{ riderId: 'rp1', _count: { _all: 3 } }], // rp2 has no active assignments
    );

    const candidates = await loadRiderCandidates(p as never, ['rp1', 'rp2']);

    expect(candidates).toEqual([
      { riderProfileId: 'rp1', userId: 'u1', activeCount: 3 },
      { riderProfileId: 'rp2', userId: 'u2', activeCount: 0 },
    ]);
    // Same selection outcome as the old per-rider loop: fewest-active wins.
    expect(pickBestRider(candidates)?.riderProfileId).toBe('rp2');
  });

  it('skips dangling profile ids (old `if (profile)` guard preserved)', async () => {
    const p = makePrisma([{ id: 'rp1', userId: 'u1' }], []);
    const candidates = await loadRiderCandidates(p as never, ['rp1', 'rp-gone']);
    expect(candidates).toEqual([{ riderProfileId: 'rp1', userId: 'u1', activeCount: 0 }]);
  });

  it('preserves input order for pickBestRider’s stable tie-break', async () => {
    const p = makePrisma(
      [{ id: 'rpB', userId: 'uB' }, { id: 'rpA', userId: 'uA' }], // DB returns any order
      [],
    );
    const candidates = await loadRiderCandidates(p as never, ['rpA', 'rpB']);
    expect(candidates.map((c) => c.riderProfileId)).toEqual(['rpA', 'rpB']);
  });

  it('short-circuits to no queries for an empty rider list', async () => {
    const p = makePrisma([], []);
    expect(await loadRiderCandidates(p as never, [])).toEqual([]);
    expect(p.riderProfile.findMany).not.toHaveBeenCalled();
  });
});
