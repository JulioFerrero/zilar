import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  canDeleteMessage,
  canEditMessage,
  editsFor,
  EDIT_WINDOW_MS,
  emptyEdits,
  isSameAuthor,
  mergeEdits,
  resolveEdits,
  type EditAuthor,
  type EditUpdate,
  type EditsState,
} from './edits';
import type { UiMessage } from './types';

const ANA: EditAuthor = { jid: 'ana@x', resolved: true };
const LUIS: EditAuthor = { jid: 'luis@x', resolved: true };

function correction(targetId: string, text: string, order: number, author: EditAuthor = ANA) {
  return { kind: 'correction' as const, targetId, author, text, order };
}

function retraction(targetId: string, order: number, author: EditAuthor = ANA) {
  return { kind: 'retraction' as const, targetId, author, order };
}

function apply(state: EditsState, update: EditUpdate, target?: EditAuthor) {
  return applyEdit(state, update, target ?? ANA);
}

describe('applyEdit corrections', () => {
  it('applies a correction from the original sender', () => {
    const state = apply(emptyEdits(), correction('m-1', 'fixed', 1));
    expect(editsFor(state, 'm-1')).toEqual({ edited: true, deleted: false, text: 'fixed' });
  });

  it('keeps the latest correction in stanza order', () => {
    let state = apply(emptyEdits(), correction('m-1', 'first', 1));
    state = apply(state, correction('m-1', 'second', 2));
    state = apply(state, correction('m-1', 'older', 1));

    expect(editsFor(state, 'm-1').text).toBe('second');
  });

  it('ignores a foreign sender in a DM', () => {
    const state = apply(emptyEdits(), correction('m-1', 'hijacked', 1, LUIS));
    expect(editsFor(state, 'm-1')).toEqual({ edited: false, deleted: false });
  });

  it('ignores a retraction from a foreign sender', () => {
    let state = apply(emptyEdits(), correction('m-1', 'fixed', 1));
    state = applyEdit(state, retraction('m-1', 2, LUIS), ANA);
    expect(editsFor(state, 'm-1')).toEqual({ edited: true, deleted: false, text: 'fixed' });
  });

  it('carries the mention ranges of the correction', () => {
    const update = {
      ...correction('m-1', '@Ana hi', 1),
      mentions: [{ jid: 'ana@x', begin: 0, end: 4 }],
    };
    const state = applyEdit(emptyEdits(), update, ANA);
    expect(editsFor(state, 'm-1').mentions).toEqual([{ jid: 'ana@x', begin: 0, end: 4 }]);
  });
});

describe('applyEdit retractions', () => {
  it('a retraction wins over a later correction', () => {
    let state = apply(emptyEdits(), correction('m-1', 'fixed', 1));
    state = apply(state, retraction('m-1', 2));
    state = apply(state, correction('m-1', 'resurrected', 3));

    expect(editsFor(state, 'm-1')).toEqual({ edited: false, deleted: true });
  });

  it('a retraction wins when it arrives first', () => {
    let state = apply(emptyEdits(), retraction('m-1', 5));
    state = apply(state, correction('m-1', 'later', 6));
    expect(editsFor(state, 'm-1')).toEqual({ edited: false, deleted: true });
  });
});

describe('applyEdit authorization fallbacks', () => {
  it('compares occupant-ids when neither side is resolved', () => {
    const original: EditAuthor = {
      jid: 'room/a',
      resolved: false,
      occupantId: 'occ-1',
      nick: 'Ana',
    };
    const same: EditAuthor = {
      jid: 'room/a',
      resolved: false,
      occupantId: 'occ-1',
      nick: 'Ana',
    };
    const other: EditAuthor = {
      jid: 'room/b',
      resolved: false,
      occupantId: 'occ-2',
      nick: 'Bea',
    };
    expect(isSameAuthor(original, same)).toBe(true);
    expect(isSameAuthor(original, other)).toBe(false);

    const state = applyEdit(emptyEdits(), correction('m-1', 'fixed', 1, same), original);
    expect(editsFor(state, 'm-1').text).toBe('fixed');
  });

  it('falls back to the nick when there is no occupant-id', () => {
    const original: EditAuthor = { jid: 'room/a', resolved: false, nick: 'Ana' };
    const same: EditAuthor = { jid: 'room/b', resolved: false, nick: 'Ana' };
    const other: EditAuthor = { jid: 'room/c', resolved: false, nick: 'Bea' };

    expect(isSameAuthor(original, same)).toBe(true);
    expect(isSameAuthor(original, other)).toBe(false);
  });

  it('ignores a foreign occupant in a group', () => {
    const original: EditAuthor = {
      jid: 'room/a',
      resolved: false,
      occupantId: 'occ-1',
      nick: 'Ana',
    };
    const foreign: EditAuthor = {
      jid: 'room/b',
      resolved: false,
      occupantId: 'occ-2',
      nick: 'Bea',
    };
    const state = applyEdit(emptyEdits(), correction('m-1', 'hijacked', 1, foreign), original);
    expect(editsFor(state, 'm-1')).toEqual({ edited: false, deleted: false });
  });
});

describe('pending updates', () => {
  it('keeps a correction until its target loads, then applies it', () => {
    let state = applyEdit(emptyEdits(), correction('m-1', 'fixed', 1));
    expect(editsFor(state, 'm-1')).toEqual({ edited: false, deleted: false });

    state = resolveEdits(state, 'm-1', ANA);
    expect(editsFor(state, 'm-1')).toEqual({ edited: true, deleted: false, text: 'fixed' });
  });

  it('keeps a retraction until its target loads, then applies it', () => {
    let state = applyEdit(emptyEdits(), retraction('m-1', 1));
    state = resolveEdits(state, 'm-1', ANA);
    expect(editsFor(state, 'm-1')).toEqual({ edited: false, deleted: true });
  });

  it('applies pending updates from a foreign author as ignored once resolved', () => {
    let state = applyEdit(emptyEdits(), correction('m-1', 'hijacked', 1, LUIS));
    state = resolveEdits(state, 'm-1', ANA);
    expect(editsFor(state, 'm-1')).toEqual({ edited: false, deleted: false });
  });

  it('applies the latest pending correction once the target loads', () => {
    let state = applyEdit(emptyEdits(), correction('m-1', 'first', 2));
    state = applyEdit(state, correction('m-1', 'second', 3));
    state = resolveEdits(state, 'm-1', ANA);
    expect(editsFor(state, 'm-1').text).toBe('second');
  });

  it('is idempotent when the same update arrives twice', () => {
    let state = applyEdit(emptyEdits(), correction('m-1', 'fixed', 1));
    state = applyEdit(state, correction('m-1', 'fixed', 1));
    expect(state.targets['m-1']?.pending).toHaveLength(1);
    state = resolveEdits(state, 'm-1', ANA);
    expect(editsFor(state, 'm-1').text).toBe('fixed');
  });

  it('leaves the state alone when there is nothing to resolve', () => {
    const state = applyEdit(emptyEdits(), correction('m-1', 'fixed', 1), ANA);
    expect(resolveEdits(state, 'm-2', ANA)).toBe(state);
  });
});

describe('mergeEdits', () => {
  it('moves an entry onto the surviving target', () => {
    let state = applyEdit(emptyEdits(), correction('srv-1', 'fixed', 2), ANA);
    const merged = mergeEdits(state, 'srv-1', 'local-1');

    expect(merged.targets['srv-1']).toBeUndefined();
    expect(editsFor(merged, 'local-1').text).toBe('fixed');
  });

  it('keeps a retraction from either side', () => {
    let state = applyEdit(emptyEdits(), retraction('srv-1', 3), ANA);
    state = applyEdit(state, correction('local-1', 'older', 1), ANA);
    const merged = mergeEdits(state, 'srv-1', 'local-1');
    expect(editsFor(merged, 'local-1')).toEqual({ edited: false, deleted: true });
  });

  it('leaves the state alone when the source is unknown', () => {
    const state = applyEdit(emptyEdits(), correction('m-1', 'fixed', 1), ANA);
    expect(mergeEdits(state, 'nope', 'm-1')).toBe(state);
  });
});

describe('sender-side limits', () => {
  const now = new Date('2026-09-29T12:00:00Z');

  function message(
    overrides: Partial<Omit<UiMessage, 'text'>> & { text?: string | undefined },
  ): UiMessage {
    const { text, ...rest } = overrides;
    const result: UiMessage = {
      id: 'm-1',
      chatId: 'c-1',
      senderId: 'me',
      senderName: 'You',
      text: 'hello',
      createdAt: new Date('2026-09-29T11:00:00Z'),
      status: 'sent',
      ...rest,
    };
    if (Object.prototype.hasOwnProperty.call(overrides, 'text')) {
      if (text === undefined) {
        delete result.text;
      } else {
        result.text = text;
      }
    }
    return result;
  }

  it('allows editing my own recent text message', () => {
    expect(canEditMessage(message({}), 'me', now)).toBe(true);
  });

  it('refuses another sender, a deleted message and a non-text message', () => {
    expect(canEditMessage(message({ senderId: 'ana' }), 'me', now)).toBe(false);
    expect(canEditMessage(message({ deleted: true, text: undefined }), 'me', now)).toBe(false);
    expect(
      canEditMessage(
        message({
          text: undefined,
          voice: { duration_ms: 1, mime: 'audio/mp4', waveform: [1] },
        }),
        'me',
        now,
      ),
    ).toBe(false);
    expect(
      canEditMessage(
        message({ text: undefined, image: { url: 'x', width: 1, height: 1 } }),
        'me',
        now,
      ),
    ).toBe(false);
  });

  it('refuses a message older than 48 hours', () => {
    const old = message({ createdAt: new Date(now.getTime() - EDIT_WINDOW_MS - 1) });
    expect(canEditMessage(old, 'me', now)).toBe(false);
  });

  it('allows deleting my own message of any kind and no time limit', () => {
    const old = message({
      text: undefined,
      voice: { duration_ms: 1, mime: 'audio/mp4', waveform: [1] },
      createdAt: new Date('2020-01-01T00:00:00Z'),
    });
    expect(canDeleteMessage(old, 'me')).toBe(true);
    expect(canDeleteMessage(message({ senderId: 'ana' }), 'me')).toBe(false);
  });
});
