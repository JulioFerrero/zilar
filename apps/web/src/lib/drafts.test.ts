import { describe, expect, it, vi } from 'vitest';
import {
  DRAFT_STREAM_URL,
  subscribeToDrafts,
  type DraftEventSource,
  type DraftHubEvent,
} from './drafts';

const TURN = '3f1a2b3c-4d5e-6f70-8a9b-0c1d2e3f4a5b';

function fakeSource() {
  const listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  const close = vi.fn();
  const urls: string[] = [];
  const source: DraftEventSource = {
    addEventListener: (type, listener) => {
      let set = listeners.get(type);
      if (set === undefined) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener);
    },
    close,
  };
  return {
    close,
    urls,
    create: (url: string): DraftEventSource => {
      urls.push(url);
      return source;
    },
    emit: (type: 'draft' | 'end', data: string): void => {
      for (const listener of listeners.get(type) ?? []) {
        listener({ data } as MessageEvent);
      }
    },
  };
}

describe('subscribeToDrafts', () => {
  it('opens the same-origin stream and passes valid events through', () => {
    const events: DraftHubEvent[] = [];
    const fake = fakeSource();
    const close = subscribeToDrafts((event) => events.push(event), fake.create);

    expect(fake.urls).toEqual([DRAFT_STREAM_URL]);

    fake.emit(
      'draft',
      JSON.stringify({ type: 'draft', chatJid: 'ai@zilar.test', turnId: TURN, text: 'Hel' }),
    );
    fake.emit(
      'end',
      JSON.stringify({ type: 'end', chatJid: 'ai@zilar.test', turnId: TURN, outcome: 'failed' }),
    );

    expect(events).toEqual([
      { type: 'draft', chatJid: 'ai@zilar.test', turnId: TURN, text: 'Hel' },
      { type: 'end', chatJid: 'ai@zilar.test', turnId: TURN, outcome: 'failed' },
    ]);

    close();
  });

  it('drops invalid JSON and wrong shapes silently', () => {
    const onEvent = vi.fn();
    const fake = fakeSource();
    subscribeToDrafts(onEvent, fake.create);

    fake.emit('draft', 'not json');
    fake.emit('draft', JSON.stringify({ type: 'draft', chatJid: '', turnId: TURN, text: 'x' }));
    fake.emit(
      'draft',
      JSON.stringify({ type: 'draft', chatJid: 'ai@zilar.test', turnId: 'nope', text: 'x' }),
    );
    fake.emit(
      'end',
      JSON.stringify({ type: 'end', chatJid: 'ai@zilar.test', turnId: TURN, outcome: 'weird' }),
    );
    fake.emit('draft', JSON.stringify({ type: 'something-else' }));

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('closes the source and does nothing when EventSource is unavailable', () => {
    const fake = fakeSource();
    const close = subscribeToDrafts(() => {}, fake.create);
    close();
    expect(fake.close).toHaveBeenCalledTimes(1);

    const failing = (): DraftEventSource => {
      throw new Error('no EventSource');
    };
    const noop = subscribeToDrafts(() => {}, failing);
    expect(() => noop()).not.toThrow();
  });
});
