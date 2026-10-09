import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Exit, Schema } from 'effect';
import { DraftEventSchema, DraftEndEventSchema, DraftHubEventSchema } from './events';
import type { DraftHubEvent } from './events';
import { createDraftHub, DRAFT_MAX_CHARS, DRAFT_THROTTLE_MS } from './hub';

const OWNER = 'user-owner-1';
const OTHER = 'user-other-2';
const CHAT_JID = 'ai-abc@zilar.localhost';

function turn(hub: ReturnType<typeof createDraftHub>, owner = OWNER) {
  return hub.publishTurn(owner, CHAT_JID, randomUUID());
}

describe('draft hub', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers drafts only to the owning user', () => {
    const hub = createDraftHub();
    const mine: DraftHubEvent[] = [];
    const theirs: DraftHubEvent[] = [];
    hub.subscribe(OWNER, (event) => mine.push(event));
    hub.subscribe(OTHER, (event) => theirs.push(event));

    const publisher = turn(hub);
    publisher.push('Hello');
    publisher.end('sent');

    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({ type: 'draft', chatJid: CHAT_JID, text: 'Hello' });
    expect(mine[1]).toMatchObject({ type: 'end', outcome: 'sent' });
    expect(theirs).toHaveLength(0);
  });

  it('fans out to every subscriber of the same user and unsubscribes cleanly', () => {
    const hub = createDraftHub();
    const tabs: DraftHubEvent[][] = [[], [], []];
    const unsubs = tabs.map((tab) => hub.subscribe(OWNER, (event) => tab.push(event)));
    expect(hub.listenerCount(OWNER)).toBe(3);

    turn(hub).end('failed');
    for (const tab of tabs) {
      expect(tab).toHaveLength(1);
      expect(tab[0]).toMatchObject({ type: 'end', outcome: 'failed' });
    }

    unsubs[0]?.();
    expect(hub.listenerCount(OWNER)).toBe(2);
    unsubs[1]?.();
    unsubs[2]?.();
    expect(hub.listenerCount(OWNER)).toBe(0);
    expect(hub.listenerCount(OTHER)).toBe(0);
  });

  it('throttles a burst: 50 deltas in 100 ms become at most 2 drafts, last equals full text', () => {
    vi.useFakeTimers();
    const hub = createDraftHub();
    const seen: DraftHubEvent[] = [];
    hub.subscribe(OWNER, (event) => seen.push(event));

    const publisher = turn(hub);
    let text = '';
    for (let i = 0; i < 50; i += 1) {
      text += `word${i} `;
      publisher.push(text);
      vi.advanceTimersByTime(2);
    }
    const draftsBeforeEnd = seen.filter((event) => event.type === 'draft');
    expect(draftsBeforeEnd.length).toBeLessThanOrEqual(2);

    publisher.end('sent');
    const drafts = seen.filter((event) => event.type === 'draft');
    expect(drafts.length).toBeLessThanOrEqual(2);
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    expect(drafts.at(-1)).toMatchObject({ type: 'draft', text });
    expect(seen.at(-1)).toMatchObject({ type: 'end', outcome: 'sent' });
  });

  it('sends the first draft of a quiet turn immediately', () => {
    vi.useFakeTimers();
    const hub = createDraftHub();
    const seen: DraftHubEvent[] = [];
    hub.subscribe(OWNER, (event) => seen.push(event));

    const publisher = turn(hub);
    publisher.push('Hello');
    expect(seen).toHaveLength(1);
    publisher.end('sent');
    expect(seen).toHaveLength(2);
  });

  it('drops duplicate text and stops past the character cap', () => {
    vi.useFakeTimers();
    const hub = createDraftHub();
    const seen: DraftHubEvent[] = [];
    hub.subscribe(OWNER, (event) => seen.push(event));

    const publisher = turn(hub);
    publisher.push('same');
    publisher.push('same');
    vi.advanceTimersByTime(DRAFT_THROTTLE_MS * 2);
    expect(seen.filter((event) => event.type === 'draft')).toHaveLength(1);

    const long = `x`.repeat(DRAFT_MAX_CHARS + 1);
    publisher.push(long);
    vi.advanceTimersByTime(DRAFT_THROTTLE_MS * 2);
    publisher.end('sent');
    const drafts = seen.filter((event) => event.type === 'draft');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ text: 'same' });
    expect(seen.at(-1)).toMatchObject({ type: 'end', outcome: 'sent' });
  });

  it('end after end publishes once', () => {
    const hub = createDraftHub();
    const seen: DraftHubEvent[] = [];
    hub.subscribe(OWNER, (event) => seen.push(event));

    const publisher = turn(hub);
    publisher.end('sent');
    publisher.end('sent');
    publisher.push('too late');
    expect(seen).toHaveLength(1);
  });

  it('flush publishes now inside the throttle window and end does not repeat it', () => {
    vi.useFakeTimers();
    const hub = createDraftHub();
    const seen: DraftHubEvent[] = [];
    hub.subscribe(OWNER, (event) => seen.push(event));

    const publisher = turn(hub);
    publisher.push('Hello');
    expect(seen.filter((event) => event.type === 'draft')).toHaveLength(1);
    publisher.push('Hello, Ju');
    publisher.flush('Hello, Julio, the whole reply');
    const drafts = seen.filter((event) => event.type === 'draft');
    expect(drafts).toHaveLength(2);
    expect(drafts.at(-1)).toMatchObject({ text: 'Hello, Julio, the whole reply' });

    // The pending throttle timer was cancelled: nothing more arrives.
    vi.advanceTimersByTime(DRAFT_THROTTLE_MS * 3);
    expect(seen.filter((event) => event.type === 'draft')).toHaveLength(2);

    publisher.end('sent');
    expect(seen.filter((event) => event.type === 'draft')).toHaveLength(2);
    expect(seen.at(-1)).toMatchObject({ type: 'end', outcome: 'sent' });
  });

  it('flush skips identical and over-cap text and does nothing after end', () => {
    vi.useFakeTimers();
    const hub = createDraftHub();
    const seen: DraftHubEvent[] = [];
    hub.subscribe(OWNER, (event) => seen.push(event));

    const publisher = turn(hub);
    publisher.push('same');
    publisher.flush('same');
    expect(seen.filter((event) => event.type === 'draft')).toHaveLength(1);

    publisher.flush('x'.repeat(DRAFT_MAX_CHARS + 1));
    vi.advanceTimersByTime(DRAFT_THROTTLE_MS * 2);
    publisher.end('sent');
    // The over-cap text is never published: `end` publishes only the outcome.
    expect(seen.filter((event) => event.type === 'draft')).toHaveLength(1);
    expect(seen.at(-1)).toMatchObject({ type: 'end', outcome: 'sent' });

    publisher.flush('too late');
    publisher.push('too late');
    expect(seen).toHaveLength(2);
  });

  it('an over-cap flush leaves a pending in-cap draft to go out on its timer', () => {
    vi.useFakeTimers();
    const hub = createDraftHub();
    const seen: DraftHubEvent[] = [];
    hub.subscribe(OWNER, (event) => seen.push(event));

    const publisher = turn(hub);
    publisher.push('first');
    publisher.push('first and more');
    publisher.flush('x'.repeat(DRAFT_MAX_CHARS + 1));
    vi.advanceTimersByTime(DRAFT_THROTTLE_MS);

    expect(seen.map((event) => (event.type === 'draft' ? event.text : event.type))).toEqual([
      'first',
      'first and more',
    ]);
  });

  it('end interrupts a pending throttled flush, so nothing publishes after end', () => {
    vi.useFakeTimers();
    const hub = createDraftHub();
    const seen: DraftHubEvent[] = [];
    hub.subscribe(OWNER, (event) => seen.push(event));

    const publisher = turn(hub);
    publisher.push('first');
    publisher.push('first and more');
    expect(vi.getTimerCount()).toBe(1);

    publisher.end('sent');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(DRAFT_THROTTLE_MS * 3);
    expect(seen.map((event) => (event.type === 'draft' ? event.text : event.type))).toEqual([
      'first',
      'first and more',
      'end',
    ]);

    // Control: on a turn that is not ended, the pending flush does fire under fake timers.
    const other = turn(hub);
    other.push('a');
    other.push('ab');
    vi.advanceTimersByTime(DRAFT_THROTTLE_MS);
    expect(seen.at(-1)).toMatchObject({ type: 'draft', text: 'ab' });
  });
});

describe('draft event contract', () => {
  it('accepts the draft and end shapes T-0043 builds against', () => {
    const turnId = randomUUID();
    expect(
      Exit.isSuccess(
        Schema.decodeUnknownExit(DraftHubEventSchema)({
          type: 'draft',
          chatJid: CHAT_JID,
          turnId,
          text: 'hi',
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        Schema.decodeUnknownExit(DraftHubEventSchema)({
          type: 'end',
          chatJid: CHAT_JID,
          turnId,
          outcome: 'sent',
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        Schema.decodeUnknownExit(DraftEventSchema)({ type: 'draft', chatJid: CHAT_JID, turnId }),
      ),
    ).toBe(false);
    expect(
      Exit.isSuccess(
        Schema.decodeUnknownExit(DraftEndEventSchema)({
          type: 'end',
          chatJid: CHAT_JID,
          turnId,
          outcome: 'maybe',
        }),
      ),
    ).toBe(false);
  });
});
