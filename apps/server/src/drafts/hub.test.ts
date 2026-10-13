// The draft hub (T-1291, AI-11): a subscriber that connects mid-turn is sent
// the open turn's latest frame at once, and nothing is replayed after `end`.
import { describe, expect, it } from 'vitest';
import type { DraftHubEvent } from './events';
import { createDraftHub } from './hub';

const OWNER = 'owner@zilar.test';
const OTHER_OWNER = 'other@zilar.test';
const AI = 'ai@zilar.test';
const TURN = '11111111-1111-4111-8111-111111111111';

describe('draft hub late subscribe (AI-11)', () => {
  it("sends the open turn's latest frame to a mid-turn subscriber", () => {
    const hub = createDraftHub();
    const publisher = hub.publishTurn(OWNER, AI, TURN);
    publisher.push('Hel');
    publisher.flush('Hello');

    const events: DraftHubEvent[] = [];
    hub.subscribe(OWNER, (event) => events.push(event));

    expect(events).toEqual([{ type: 'draft', chatJid: AI, turnId: TURN, text: 'Hello' }]);
  });

  it('replays the latest frame before the live events', () => {
    const hub = createDraftHub();
    const publisher = hub.publishTurn(OWNER, AI, TURN);
    publisher.flush('Hello');

    const events: DraftHubEvent[] = [];
    hub.subscribe(OWNER, (event) => events.push(event));
    publisher.flush('Hello world');

    expect(events).toEqual([
      { type: 'draft', chatJid: AI, turnId: TURN, text: 'Hello' },
      { type: 'draft', chatJid: AI, turnId: TURN, text: 'Hello world' },
    ]);
  });

  it('clears the frame on end, so a later subscriber gets nothing', () => {
    const hub = createDraftHub();
    const publisher = hub.publishTurn(OWNER, AI, TURN);
    publisher.push('Hi');
    publisher.end('sent');

    const events: DraftHubEvent[] = [];
    hub.subscribe(OWNER, (event) => events.push(event));

    expect(events).toEqual([]);
  });

  it("never replays another owner's frame", () => {
    const hub = createDraftHub();
    hub.publishTurn(OWNER, AI, TURN).push('Hi');

    const events: DraftHubEvent[] = [];
    hub.subscribe(OTHER_OWNER, (event) => events.push(event));

    expect(events).toEqual([]);
  });
});
