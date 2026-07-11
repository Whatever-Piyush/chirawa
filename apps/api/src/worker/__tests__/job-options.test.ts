import { describe, it, expect } from 'vitest';
import { DEFAULT_JOB_OPTIONS } from '../queues';

// P1-8: these invariants are the contract that makes background jobs
// survivable and debuggable. If someone weakens one, this test makes the
// trade-off explicit in a PR instead of silent.

describe('DEFAULT_JOB_OPTIONS (P1-8)', () => {
  it('retries transient failures: ≥3 attempts with exponential backoff', () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_JOB_OPTIONS.backoff.type).toBe('exponential');
    expect(DEFAULT_JOB_OPTIONS.backoff.delay).toBeGreaterThanOrEqual(1_000);
  });

  it('keeps failed jobs for at least 7 days — failures are evidence', () => {
    expect(DEFAULT_JOB_OPTIONS.removeOnFail.age).toBeGreaterThanOrEqual(7 * 24 * 3600);
    expect(DEFAULT_JOB_OPTIONS.removeOnFail.count).toBeGreaterThanOrEqual(100);
  });

  it('bounds completed-job history so Redis cannot grow without limit', () => {
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete.age).toBeLessThanOrEqual(7 * 24 * 3600);
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete.count).toBeLessThanOrEqual(10_000);
  });

  it('total retry window stays within one assignment cycle (~5 min), not hours', () => {
    // exponential: delay × (2^attempts − 1) summed — keep the worst case sane so
    // a permanently-broken job fails visibly instead of ghost-retrying all day.
    const { attempts, backoff } = DEFAULT_JOB_OPTIONS;
    const worstCaseMs = backoff.delay * (2 ** attempts - 1);
    expect(worstCaseMs).toBeLessThanOrEqual(10 * 60 * 1000);
  });
});
