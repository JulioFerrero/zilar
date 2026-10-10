import type { ChatPrefRow } from '@zilar/chat-core';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { updatePref, withPrefRow, type PrefsApi, type PrefsStore } from './prefs';
import { ANA, NOW, testCtx } from './test-ctx';

interface Patch {
  mutedUntil?: string | null;
  archived?: boolean;
  pinned?: boolean;
}

interface Row extends ChatPrefRow {
  updatedAt: string;
}

const row = (chatJid: string, overrides: Partial<Row> = {}): Row => ({
  chatJid,
  mutedUntil: null,
  archived: false,
  pinnedAt: null,
  updatedAt: '2026-09-28T11:00:00.000Z',
  ...overrides,
});

function testPrefsStore(initial: Row[]) {
  let saved = [...initial];
  const painted: Row[][] = [];
  const store: PrefsStore<Patch, Row> = {
    savedRows: () => saved,
    setSavedRows: (rows) => {
      saved = [...rows];
    },
    paint: (rows) => {
      painted.push([...rows]);
    },
    optimisticRow: (chatJid, rows, patch, now) => {
      const existing = rows.find((entry) => entry.chatJid.toLowerCase() === chatJid.toLowerCase());
      return {
        chatJid,
        mutedUntil: patch.mutedUntil ?? existing?.mutedUntil ?? null,
        archived: patch.archived ?? existing?.archived ?? false,
        pinnedAt:
          patch.pinned === undefined
            ? (existing?.pinnedAt ?? null)
            : patch.pinned
              ? now.toISOString()
              : null,
        updatedAt: now.toISOString(),
      };
    },
  };
  return { store, painted, saved: () => saved };
}

describe('withPrefRow (core)', () => {
  it('replaces, appends and removes by lowercased chat jid', () => {
    const rows = [row('A@x.test')];
    expect(withPrefRow(rows, 'a@x.test', null)).toEqual([]);
    expect(withPrefRow(rows, 'B@x.test', row('b@x.test'))).toHaveLength(2);
    expect(
      withPrefRow(rows, 'A@x.test', row('a@x.test', { mutedUntil: 'later' }))[0]?.mutedUntil,
    ).toBe('later');
  });
});

describe('updatePref (core)', () => {
  it('paints optimistically then settles on the saved row', async () => {
    const { ctx } = testCtx();
    const { store, painted, saved } = testPrefsStore([row(ANA)]);
    const api = {
      putChatPref: vi.fn(async () => row(ANA, { pinnedAt: '2026-09-28T12:00:00.000Z' })),
    } as unknown as PrefsApi<Patch, Row>;

    await Effect.runPromise(updatePref(ctx, api, store, ANA, { pinned: true }));
    // The optimistic paint shows the pin before the server answers.
    expect(painted[0]?.find((entry) => entry.chatJid === ANA)?.pinnedAt).toBe(NOW.toISOString());
    expect(saved().find((entry) => entry.chatJid === ANA)?.pinnedAt).toBe(
      '2026-09-28T12:00:00.000Z',
    );
    expect(painted.at(-1)).toEqual(saved());
  });

  it('drops the row when the write lands on defaults', async () => {
    const { ctx } = testCtx();
    const { store, saved } = testPrefsStore([row(ANA, { mutedUntil: 'later' })]);
    const api = { putChatPref: vi.fn(async () => null) } as unknown as PrefsApi<Patch, Row>;

    await Effect.runPromise(updatePref(ctx, api, store, ANA, { mutedUntil: null }));
    expect(saved()).toEqual([]);
  });

  it('keeps a saved row that landed mid-flight when the write fails (R11)', async () => {
    let release!: (error: Error) => void;
    const gate = new Promise<never>((_resolve, reject) => {
      release = reject;
    });
    const { ctx } = testCtx();
    const { store, painted, saved } = testPrefsStore([row(ANA)]);
    const api = {
      putChatPref: vi.fn(() => gate),
    } as unknown as PrefsApi<Patch, Row>;

    const pending = Effect.runPromise(updatePref(ctx, api, store, ANA, { pinned: true }));
    // A background refresh lands while the PUT is in flight: a new saved row.
    store.paint([...saved(), row('b@x.test')]);
    store.setSavedRows([...saved(), row('b@x.test')]);

    release(new Error('offline'));
    await expect(pending).rejects.toThrow('offline');

    // Only the failed pin is dropped; the landed row survives.
    expect(saved().map((entry) => entry.chatJid)).toEqual([ANA, 'b@x.test']);
    expect(saved().find((entry) => entry.chatJid === ANA)?.pinnedAt).toBeNull();
    expect(painted.at(-1)).toEqual(saved());
  });

  it('rejects an unknown chat without a request', async () => {
    const { ctx } = testCtx();
    const { store } = testPrefsStore([]);
    const api = { putChatPref: vi.fn() } as unknown as PrefsApi<Patch, Row>;

    await expect(
      Effect.runPromise(updatePref(ctx, api, store, 'nope', { archived: true })),
    ).rejects.toThrow('This chat is not available yet.');
    expect(api.putChatPref).not.toHaveBeenCalled();
  });
});
