// T-1758: the `post_blocks` runner posts one blocks card for a valid call and
// refuses a call whose blocks fail validation, without sending anything.
import type { Payload } from '@zilar/protocol';
import type { XmppCore } from '@zilar/xmpp-core';
import { describe, expect, it } from 'vitest';
import { createPostBlocksRunner } from './post-blocks';
import type { AiSession, GatewayLogger } from './contracts';

const silentLogger: GatewayLogger = { info: () => {}, warn: () => {} };

function sessionFor(aiId: string, aiJid: string, room: string): AiSession {
  return {
    aiId,
    aiJid,
    core: {} as XmppCore,
    busy: false,
    pending: [],
    stopped: false,
    retryAttempt: 0,
    retryTimer: undefined,
    unsubs: [],
    turnAborts: new Map(),
    rooms: new Map([[room, { groupId: 'g-1', topicId: 'topic-1', joinedAtMs: 0, nick: 'Helper' }]]),
    roomPending: new Map(),
    roomBusy: new Set(),
    roomTurns: new Map(),
    roomRateNotices: new Map(),
    roomSentIds: new Map(),
  };
}

interface SentMessage {
  to: string;
  kind: string;
  text: string;
  payload?: Payload;
}

function recordingSend(sent: SentMessage[]) {
  return async (
    _session: AiSession,
    to: string,
    kind: string,
    text: string,
    opts?: { payload?: Payload },
  ) => {
    sent.push({
      to,
      kind,
      text,
      ...(opts?.payload === undefined ? {} : { payload: opts.payload }),
    });
    return { id: 'block-1' };
  };
}

describe('post_blocks runner', () => {
  it('posts a blocks card for a valid call', async () => {
    const roomJid = 'blocks@rooms.zilar.localhost';
    const session = sessionFor('ai-1', 'helper@zilar.localhost', roomJid);
    const sent: SentMessage[] = [];
    const runner = createPostBlocksRunner(silentLogger, recordingSend(sent));

    const result = await runner.runPostBlocks(
      session,
      {
        text: '  Prices today  ',
        blocks: [{ kind: 'number', label: 'BTC', value: '$82,302' }],
      },
      { roomJid },
    );

    expect(result.content).toBe(
      'Your card was posted in this room. Do not repeat what it shows; reply with at most one short line.',
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(roomJid);
    expect(sent[0]?.kind).toBe('groupchat');
    expect(sent[0]?.text).toBe('Prices today');
    expect(sent[0]?.payload).toMatchObject({
      v: 0,
      type: 'blocks',
      data: {
        fallback: 'Prices today',
        blocks: [{ kind: 'number', label: 'BTC', value: '$82,302' }],
      },
    });
  });

  it('refuses an http link and sends nothing', async () => {
    const roomJid = 'blocks@rooms.zilar.localhost';
    const session = sessionFor('ai-1', 'helper@zilar.localhost', roomJid);
    const sent: SentMessage[] = [];
    const runner = createPostBlocksRunner(silentLogger, recordingSend(sent));

    const result = await runner.runPostBlocks(
      session,
      { text: 'A link', blocks: [{ kind: 'link', url: 'http://example.com', title: 'Example' }] },
      { roomJid },
    );

    expect(result.content.startsWith('invalid:')).toBe(true);
    expect(sent).toHaveLength(0);

    // A send that rejects must come back as a failure, not crash the tool call.
    const failing = createPostBlocksRunner(silentLogger, async () => {
      throw new Error('xmpp down');
    });
    const failed = await failing.runPostBlocks(
      session,
      { text: 'Prices today', blocks: [{ kind: 'number', label: 'BTC', value: '$82,302' }] },
      { roomJid },
    );
    expect(failed.content).toBe('error: the card could not be posted');
  });
});
