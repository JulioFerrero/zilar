// In-process group and topic AI notifiers (events.ts): every listener is
// isolated from the others and the emit is synchronous.

import { afterEach, describe, expect, it } from 'vitest';
import {
  emitGroupAi,
  emitTopicAi,
  onGroupAi,
  onTopicAi,
  type GroupAiEvent,
  type TopicAiEvent,
} from './events';

const groupEvent: GroupAiEvent = { type: 'ai-added', groupId: 'g1', aiId: 'a1' };
const topicEvent: TopicAiEvent = { type: 'ai-removed', topicId: 't1', aiId: 'a1' };

const unsubscribers: Array<() => void> = [];

function subscribe<T>(
  on: (listener: (event: T) => void) => () => void,
  listener: (event: T) => void,
) {
  const unsubscribe = on(listener);
  unsubscribers.push(unsubscribe);
  return unsubscribe;
}

afterEach(() => {
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
});

describe('emitGroupAi', () => {
  it('a throwing listener does not stop the next one', () => {
    const seen: GroupAiEvent[] = [];
    subscribe(onGroupAi, () => {
      throw new Error('gateway broke');
    });
    subscribe(onGroupAi, (event) => seen.push(event));

    expect(() => emitGroupAi(groupEvent)).not.toThrow();
    expect(seen).toEqual([groupEvent]);
  });

  it('a listener that unsubscribes a later one mid-emit is not called', () => {
    const calls: string[] = [];
    let unsubscribeLater = (): void => {};
    subscribe(onGroupAi, () => {
      calls.push('first');
      unsubscribeLater();
    });
    unsubscribeLater = subscribe(onGroupAi, () => calls.push('second'));

    emitGroupAi(groupEvent);
    expect(calls).toEqual(['first']);
  });

  it('a listener that unsubscribes itself does not skip the next one', () => {
    const calls: string[] = [];
    let unsubscribeSelf = (): void => {};
    unsubscribeSelf = subscribe(onGroupAi, () => {
      calls.push('self');
      unsubscribeSelf();
    });
    subscribe(onGroupAi, () => calls.push('next'));

    emitGroupAi(groupEvent);
    expect(calls).toEqual(['self', 'next']);
  });

  it('delivers to every listener before it returns', () => {
    let delivered = 0;
    subscribe(onGroupAi, () => {
      delivered += 1;
    });
    subscribe(onGroupAi, () => {
      delivered += 1;
    });

    emitGroupAi(groupEvent);
    expect(delivered).toBe(2);
  });
});

describe('emitTopicAi', () => {
  it('a throwing listener does not stop the next one', () => {
    const seen: TopicAiEvent[] = [];
    subscribe(onTopicAi, () => {
      throw new Error('gateway broke');
    });
    subscribe(onTopicAi, (event) => seen.push(event));

    expect(() => emitTopicAi(topicEvent)).not.toThrow();
    expect(seen).toEqual([topicEvent]);
  });
});
