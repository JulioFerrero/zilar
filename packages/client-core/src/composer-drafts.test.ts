import { afterEach, describe, expect, it, vi } from 'vitest';

import { capStoredDrafts, createComposerDrafts, type DraftStorage } from './composer-drafts';

function memoryStorage(
  initial: Record<string, Map<string, string>> = {},
): DraftStorage & { saved: Array<{ userId: string; drafts: Map<string, string> }> } {
  const stored = new Map(
    Object.entries(initial).map(([userId, drafts]) => [userId, new Map(drafts)]),
  );
  const saved: Array<{ userId: string; drafts: Map<string, string> }> = [];
  return {
    saved,
    load(userId) {
      return new Map(stored.get(userId) ?? []);
    },
    save(userId, drafts) {
      stored.set(userId, new Map(drafts));
      saved.push({ userId, drafts: new Map(drafts) });
    },
  };
}

function deferred(): {
  promise: Promise<Map<string, string>>;
  resolve: (drafts: Map<string, string>) => void;
} {
  let resolve: (drafts: Map<string, string>) => void = () => undefined;
  const promise = new Promise<Map<string, string>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createComposerDrafts', () => {
  it('never shows or writes one user drafts for another', () => {
    vi.useFakeTimers();
    const storage = memoryStorage({ alice: new Map([['a1', 'alice draft']]) });
    const drafts = createComposerDrafts(storage, { writeDelayMs: 100 });

    drafts.scopeToUser('alice');
    expect(drafts.getDraft('a1')).toBe('alice draft');
    drafts.setDraft('a2', 'typed');

    drafts.scopeToUser('bob');
    expect(drafts.getDraft('a1')).toBe('');
    expect(drafts.getDraft('a2')).toBe('');

    drafts.setDraft('b1', 'bob draft');
    vi.advanceTimersByTime(100);

    // Alice's pending write was flushed to her own key, Bob's to his.
    expect(storage.saved).toEqual([
      {
        userId: 'alice',
        drafts: new Map([
          ['a1', 'alice draft'],
          ['a2', 'typed'],
        ]),
      },
      { userId: 'bob', drafts: new Map([['b1', 'bob draft']]) },
    ]);
  });

  it('keeps text typed while an async hydrate finishes', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    const save = vi.fn();
    const drafts = createComposerDrafts(
      { load: () => pending.promise, save },
      { writeDelayMs: 50 },
    );

    drafts.scopeToUser('u1');
    drafts.setDraft('c1', 'typed');
    pending.resolve(
      new Map([
        ['c0', 'stored'],
        ['c1', 'stale'],
      ]),
    );
    await drafts.hydrate('u1');

    expect(drafts.getDraft('c1')).toBe('typed');
    expect(drafts.getDraft('c0')).toBe('stored');
    vi.advanceTimersByTime(50);
    expect(save).toHaveBeenCalledWith(
      'u1',
      new Map([
        ['c0', 'stored'],
        ['c1', 'typed'],
      ]),
    );
  });

  it('keeps a draft cleared while an async hydrate finishes empty', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    const drafts = createComposerDrafts({ load: () => pending.promise, save: () => undefined });

    drafts.scopeToUser('u1');
    drafts.setDraft('c1', 'typed');
    drafts.setDraft('c1', '');
    drafts.setDraft('c2', '');
    pending.resolve(
      new Map([
        ['c1', 'stored'],
        ['c2', 'stored'],
      ]),
    );
    await drafts.hydrate('u1');

    expect(drafts.getDraft('c1')).toBe('');
    expect(drafts.getDraft('c2')).toBe('');
    vi.advanceTimersByTime(300);
  });

  it('persists a stored-only draft cleared while an async hydrate finishes', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    const save = vi.fn();
    const drafts = createComposerDrafts(
      { load: () => pending.promise, save },
      { writeDelayMs: 50 },
    );

    drafts.scopeToUser('u1');
    drafts.setDraft('c1', '');
    pending.resolve(new Map([['c1', 'stored']]));
    await drafts.hydrate('u1');

    expect(drafts.getDraft('c1')).toBe('');
    vi.advanceTimersByTime(50);
    expect(save).toHaveBeenCalledWith('u1', new Map());
  });

  it('writes the leaving user drafts to their own key while the load is pending', async () => {
    const alice = deferred();
    const saved: Array<{ userId: string; drafts: Map<string, string> }> = [];
    const drafts = createComposerDrafts({
      load(userId) {
        return userId === 'alice' ? alice.promise : Promise.resolve(new Map<string, string>());
      },
      save(userId, snapshot) {
        saved.push({ userId, drafts: new Map(snapshot) });
      },
    });

    drafts.scopeToUser('alice');
    drafts.setDraft('c1', 'typed before load');
    drafts.scopeToUser('bob');
    expect(drafts.getDraft('c1')).toBe('');

    alice.resolve(new Map([['c0', 'stored']]));
    await drafts.hydrate('bob');
    await Promise.resolve();

    expect(saved).toEqual([
      {
        userId: 'alice',
        drafts: new Map([
          ['c0', 'stored'],
          ['c1', 'typed before load'],
        ]),
      },
    ]);
    expect(drafts.getDraft('c0')).toBe('');
  });

  it('caps drafts at 200 entries and 4000 characters', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const drafts = createComposerDrafts(storage, { writeDelayMs: 300 });

    drafts.scopeToUser('u');
    for (let index = 0; index < 205; index += 1) {
      drafts.setDraft(`c${index}`, 'x');
    }
    drafts.setDraft('long', 'y'.repeat(5000));

    expect(drafts.getDraft('c0')).toBe('');
    expect(drafts.getDraft('c4')).toBe('');
    expect(drafts.getDraft('c5')).toBe('');
    expect(drafts.getDraft('c204')).toBe('x');
    expect(drafts.getDraft('long')).toHaveLength(4000);

    vi.advanceTimersByTime(300);
    const persisted = storage.saved.at(-1)?.drafts;
    expect(persisted?.size).toBe(200);
    expect(persisted?.get('long')).toHaveLength(4000);
  });

  it('caps drafts loaded from storage', async () => {
    const stored = new Map<string, string>();
    for (let index = 0; index < 205; index += 1) {
      stored.set(`c${index}`, 'x');
    }
    stored.set('long', 'y'.repeat(5000));
    const drafts = createComposerDrafts({
      load: () => Promise.resolve(stored),
      save: () => undefined,
    });

    drafts.scopeToUser('u');
    await drafts.hydrate('u');

    expect(drafts.getDraft('c0')).toBe('');
    expect(drafts.getDraft('c5')).toBe('');
    expect(drafts.getDraft('c204')).toBe('x');
    expect(drafts.getDraft('long')).toHaveLength(4000);
  });

  it('caps every stored account, including users that are not loading', () => {
    const alice: Record<string, string> = {};
    for (let index = 0; index < 205; index += 1) {
      alice[`c${index}`] = 'x';
    }
    alice.empty = '';
    alice.long = 'y'.repeat(5000);
    const bob = { chat: 'z'.repeat(5000) };

    const capped = capStoredDrafts({ alice, bob });

    expect(capped.alice?.size).toBe(200);
    expect(capped.alice?.has('c0')).toBe(false);
    expect(capped.alice?.has('c5')).toBe(false);
    expect(capped.alice?.has('c6')).toBe(true);
    expect(capped.alice?.has('empty')).toBe(false);
    expect(capped.alice?.get('long')).toHaveLength(4000);
    expect(capped.bob?.get('chat')).toHaveLength(4000);
  });

  it('persists once, after the delay, with the latest text', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const drafts = createComposerDrafts(storage, { writeDelayMs: 300 });

    drafts.scopeToUser('u');
    drafts.setDraft('c', 'a');
    vi.advanceTimersByTime(100);
    drafts.setDraft('c', 'ab');
    vi.advanceTimersByTime(299);
    expect(storage.saved).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(storage.saved).toEqual([{ userId: 'u', drafts: new Map([['c', 'ab']]) }]);
  });
});
