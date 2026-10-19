// The draft hub (T-1291, AI-11): a subscriber only ever receives the frames of
// the owner it subscribed for.
import { describe, expect, it } from 'vitest';
import type { DraftHubEvent } from './events';
import { createDraftHub } from './hub';

const OWNER = 'owner@zilar.test';
const OTHER_OWNER = 'other@zilar.test';
const AI = 'ai@zilar.test';
const TURN = '11111111-1111-4111-8111-111111111111';

describe('draft hub late subscribe (AI-11)', () => {
  it("never replays another owner's frame", () => {
    const hub = createDraftHub();
    hub.publishTurn(OWNER, AI, TURN).push('Hi');

    const events: DraftHubEvent[] = [];
    hub.subscribe(OTHER_OWNER, (event) => events.push(event));

    expect(events).toEqual([]);
  });
});
