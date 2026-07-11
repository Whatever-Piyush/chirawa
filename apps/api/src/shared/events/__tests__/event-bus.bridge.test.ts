import { describe, it, expect, vi } from 'vitest';
import { handleBridgeMessage } from '../event-bus';

// Pure tests over the injected claim/emit — no Redis, no EventEmitter wiring.

const SELF = 'proc-self';

function msg(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    origin: 'proc-other',
    eventId: 'evt-1',
    event: 'order:status:changed',
    payload: { orderId: 'o1' },
    ...over,
  });
}

describe('handleBridgeMessage — exactly-once claim (P0-1)', () => {
  it('emits when this process WINS the claim', async () => {
    const emit = vi.fn();
    await handleBridgeMessage(msg(), async () => true, emit, SELF);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('order:status:changed', { orderId: 'o1' });
  });

  it('does NOT emit when another process won the claim', async () => {
    const emit = vi.fn();
    await handleBridgeMessage(msg(), async () => false, emit, SELF);
    expect(emit).not.toHaveBeenCalled();
  });

  it('claims (and can win) its OWN message — the origin no longer pre-emits locally', async () => {
    const emit = vi.fn();
    await handleBridgeMessage(msg({ origin: SELF }), async () => true, emit, SELF);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('emits on claim ERROR — a duplicate beats a lost order event', async () => {
    const emit = vi.fn();
    await handleBridgeMessage(
      msg(),
      async () => { throw new Error('redis down'); },
      emit,
      SELF,
    );
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('order:status:changed', { orderId: 'o1' });
  });

  // ── Legacy messages (rolling-reload window: old process, no eventId) ────────
  it('legacy message from ANOTHER process → emitted without claiming', async () => {
    const emit = vi.fn();
    const claim = vi.fn();
    await handleBridgeMessage(msg({ eventId: undefined }), claim, emit, SELF);
    expect(claim).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('legacy message from THIS process (own echo) → dropped', async () => {
    const emit = vi.fn();
    await handleBridgeMessage(msg({ eventId: undefined, origin: SELF }), async () => true, emit, SELF);
    expect(emit).not.toHaveBeenCalled();
  });

  it('malformed JSON is swallowed without emitting or throwing', async () => {
    const emit = vi.fn();
    await expect(handleBridgeMessage('{not json', async () => true, emit, SELF)).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });
});
