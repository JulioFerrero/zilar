import { describe, expect, it } from 'vitest';
import { createMockBackend, createSeed } from '../../index';

const ANA = 'ana@zilar.test';

/**
 * T-1247: the DELETE routes must replace the messages map, not mutate the
 * seed's own map. A backend built from an explicit shared `seed` (the
 * documented test override) proves it: after a delete, `reset()` must bring the
 * rows back and the caller's seed object must be untouched.
 */
describe('chats delete routes', () => {
  it('clears a thread without mutating the shared seed, so reset() restores it', async () => {
    const seed = createSeed();
    const seeded = seed.messages[ANA]?.length ?? 0;
    expect(seeded).toBeGreaterThan(0);
    const backend = createMockBackend({ seed, delayMs: 0 });

    const response = await backend.http(`/chats/${encodeURIComponent(ANA)}/history`, {
      method: 'DELETE',
    });

    expect(response?.status).toBe(204);
    expect(backend.data.messages[ANA]).toEqual([]);
    expect(seed.messages[ANA]).toHaveLength(seeded);

    backend.reset();
    expect(backend.data.messages[ANA]).toHaveLength(seeded);
  });

  it('drops one message without mutating the shared seed', async () => {
    const seed = createSeed();
    const thread = seed.messages[ANA] ?? [];
    const first = thread[0];
    if (first === undefined) {
      throw new Error('the seed has no Ana messages');
    }
    const backend = createMockBackend({ seed, delayMs: 0 });

    const response = await backend.http(
      `/chats/${encodeURIComponent(ANA)}/messages/${encodeURIComponent(first.id)}`,
      { method: 'DELETE' },
    );

    expect(response?.status).toBe(204);
    expect(backend.data.messages[ANA]).toHaveLength(thread.length - 1);
    expect(seed.messages[ANA]).toHaveLength(thread.length);

    backend.reset();
    expect(backend.data.messages[ANA]).toHaveLength(thread.length);
  });

  it('drops only the named message, leaving the earlier ones', async () => {
    const MARTA = 'marta@zilar.test';
    const seed = createSeed();
    const backend = createMockBackend({ seed, delayMs: 0 });

    const response = await backend.http(`/chats/${encodeURIComponent(MARTA)}/messages/mar-3`, {
      method: 'DELETE',
    });

    expect(response?.status).toBe(204);
    expect(backend.data.messages[MARTA]?.map((message) => message.id)).toEqual(['mar-1', 'mar-2']);
  });
});
