import { describe, expect, it } from 'vitest';
import { emptyReactions, applyReaction } from '../reactions';
import type { UiMessage } from '../types';
import {
  forwardedPayloadFor,
  forwardedUiFieldsFor,
  mentionsEqual,
  reactionChips,
  reactionsEqual,
  userLocalpartOf,
} from './ledger';

const base = { id: 'm1', text: '', time: '', sender: 'x' } as unknown as UiMessage;

describe('forwarded payloads', () => {
  it('returns undefined for a plain text message', () => {
    expect(forwardedPayloadFor(base)).toBeUndefined();
  });

  it('rejects an invalid attachment', () => {
    const message = { ...base, attachment: { nope: true } } as unknown as UiMessage;
    expect(forwardedPayloadFor(message)).toBeUndefined();
  });

  it('paints each payload kind into its ui field', () => {
    const data = { a: 1 };
    expect(forwardedUiFieldsFor({ v: 0, type: 'attachment', data } as never)).toEqual({
      attachment: data,
    });
    expect(forwardedUiFieldsFor({ v: 0, type: 'voice', data } as never)).toEqual({ voice: data });
    const card = { v: 0, type: 'sticker', data } as never;
    expect(forwardedUiFieldsFor(card)).toEqual({ card });
  });
});

describe('equality', () => {
  it('compares mentions in order', () => {
    const one = [{ jid: 'a@x', name: 'a', begin: 0, end: 2 }];
    expect(mentionsEqual(undefined, undefined)).toBe(true);
    expect(mentionsEqual(one, undefined)).toBe(false);
    expect(mentionsEqual(one, [{ ...one[0]!, name: 'other' }])).toBe(true);
    expect(mentionsEqual(one, [{ ...one[0]!, end: 3 }])).toBe(false);
  });

  it('compares reactions including reactors', () => {
    const chip = { emoji: 'x', count: 1, mine: false, reactors: ['a'] };
    expect(reactionsEqual([chip], [{ ...chip }])).toBe(true);
    expect(reactionsEqual([chip], [{ ...chip, reactors: ['b'] }])).toBe(false);
    expect(reactionsEqual([chip], [])).toBe(false);
  });
});

describe('reactionChips', () => {
  const lookups = {
    aliasRoot: (id: string) => (id === 'tmp' ? 'm1' : id),
    myJid: () => 'me@d',
    reactorName: (_chat: string, jid: string) => jid.split('@')[0]!,
  };

  it('is undefined without state or reactions', () => {
    expect(reactionChips(undefined, 'c', 'm1', lookups)).toBeUndefined();
    expect(reactionChips(emptyReactions(), 'c', 'm1', lookups)).toBeUndefined();
  });

  it('resolves aliases and marks mine', () => {
    const state = applyReaction(emptyReactions(), {
      targetId: 'm1',
      reactorJid: 'me@d',
      emojis: ['x'],
      order: 1,
    });
    expect(reactionChips(state, 'c', 'tmp', lookups)).toEqual([
      { emoji: 'x', count: 1, mine: true, reactors: ['me'] },
    ]);
  });
});

describe('userLocalpartOf', () => {
  it('lowercases a same-domain localpart only', () => {
    expect(userLocalpartOf('me@d', 'AbC@d')).toBe('abc');
    expect(userLocalpartOf('me@d', 'abc@other')).toBeUndefined();
    expect(userLocalpartOf('me@d', 'nodomain')).toBeUndefined();
    expect(userLocalpartOf(undefined, 'abc@d')).toBeUndefined();
  });
});
