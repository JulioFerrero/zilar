// T-1758: the `post_blocks` runner posts one blocks card for a valid call and
// refuses a call whose blocks fail validation, without sending anything.
// T-1791: a posted card is also recorded for interaction, best-effort.
// T-1800: a DM card goes out as a `chat` message.
// T-1824: a DM card is recorded there under the sent id, with no group or topic.
import type { Payload } from '@zilar/protocol';
import type { XmppCore } from '@zilar/xmpp-core';
import { describe, expect, it } from 'vitest';
import type { RecordCardInput } from '../../message-blocks/cards';
import { createPostBlocksRunner } from './post-blocks';
import type { AiSession, GatewayLogger } from './contracts';

const silentLogger: GatewayLogger = { info: () => {}, warn: () => {} };
const noopRecord = async () => {};

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
    const runner = createPostBlocksRunner(silentLogger, recordingSend(sent), noopRecord);

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
    const runner = createPostBlocksRunner(silentLogger, recordingSend(sent), noopRecord);

    const result = await runner.runPostBlocks(
      session,
      { text: 'A link', blocks: [{ kind: 'link', url: 'http://example.com', title: 'Example' }] },
      { roomJid },
    );

    expect(result.content.startsWith('invalid:')).toBe(true);
    expect(sent).toHaveLength(0);

    // A send that rejects must come back as a failure, not crash the tool call.
    const failing = createPostBlocksRunner(
      silentLogger,
      async () => {
        throw new Error('xmpp down');
      },
      noopRecord,
    );
    const failed = await failing.runPostBlocks(
      session,
      { text: 'Prices today', blocks: [{ kind: 'number', label: 'BTC', value: '$82,302' }] },
      { roomJid },
    );
    expect(failed.content).toBe('error: the card could not be posted');
  });

  it('records the posted card with the origin id, the room and the card data', async () => {
    const roomJid = 'blocks@rooms.zilar.localhost';
    const session = sessionFor('ai-1', 'helper@zilar.localhost', roomJid);
    const sent: SentMessage[] = [];
    const records: RecordCardInput[] = [];
    const runner = createPostBlocksRunner(silentLogger, recordingSend(sent), async (input) => {
      records.push(input);
    });

    const result = await runner.runPostBlocks(
      session,
      { text: 'Prices today', blocks: [{ kind: 'number', label: 'BTC', value: '$82,302' }] },
      { roomJid, groupId: 'g-1', topicId: 'topic-1' },
    );

    expect(result.content).toBe(
      'Your card was posted in this room. Do not repeat what it shows; reply with at most one short line.',
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      originId: 'block-1',
      aiId: 'ai-1',
      groupId: 'g-1',
      topicId: 'topic-1',
      roomJid,
    });
    expect(records[0]?.data).toMatchObject({
      fallback: 'Prices today',
      blocks: [{ kind: 'number', label: 'BTC', value: '$82,302' }],
    });
  });

  it('records the DM card under the sent id with no group or topic', async () => {
    const dmJid = 'owner@zilar.localhost';
    const session = sessionFor('ai-1', 'helper@zilar.localhost', 'blocks@rooms.zilar.localhost');
    const sent: SentMessage[] = [];
    const records: RecordCardInput[] = [];
    const runner = createPostBlocksRunner(silentLogger, recordingSend(sent), async (input) => {
      records.push(input);
    });

    const result = await runner.runPostBlocks(
      session,
      { text: 'Prices today', blocks: [{ kind: 'number', label: 'BTC', value: '$82,302' }] },
      { roomJid: dmJid, kind: 'chat' },
    );

    expect(result.content).toBe(
      'Your card was posted in this chat. Do not repeat what it shows; reply with at most one short line.',
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(dmJid);
    expect(sent[0]?.kind).toBe('chat');
    expect(sent[0]?.payload).toMatchObject({ v: 0, type: 'blocks' });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      originId: 'block-1',
      aiId: 'ai-1',
      roomJid: dmJid,
    });
    expect(records[0]).not.toHaveProperty('groupId');
    expect(records[0]).not.toHaveProperty('topicId');
  });

  it('posts an interactive card in the owner DM and records it', async () => {
    const dmJid = 'owner@zilar.localhost';
    const session = sessionFor('ai-1', 'helper@zilar.localhost', 'blocks@rooms.zilar.localhost');
    const sent: SentMessage[] = [];
    const records: RecordCardInput[] = [];
    const runner = createPostBlocksRunner(silentLogger, recordingSend(sent), async (input) => {
      records.push(input);
    });

    const result = await runner.runPostBlocks(
      session,
      {
        text: 'Lunch?',
        blocks: [
          {
            kind: 'poll',
            id: 'lunch',
            question: 'Where do we eat?',
            options: [{ id: 'thai', label: 'Thai' }],
          },
        ],
      },
      { roomJid: dmJid, kind: 'chat' },
    );

    expect(result.content).toBe(
      'Your card was posted in this chat. Do not repeat what it shows; reply with at most one short line.',
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(dmJid);
    expect(sent[0]?.kind).toBe('chat');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      originId: 'block-1',
      aiId: 'ai-1',
      roomJid: dmJid,
    });
    expect(records[0]?.data).toMatchObject({
      blocks: [{ kind: 'poll', id: 'lunch', question: 'Where do we eat?' }],
    });
    expect(records[0]).not.toHaveProperty('groupId');
    expect(records[0]).not.toHaveProperty('topicId');
  });

  it('keeps the posted result when recording the card fails', async () => {
    const roomJid = 'blocks@rooms.zilar.localhost';
    const session = sessionFor('ai-1', 'helper@zilar.localhost', roomJid);
    const sent: SentMessage[] = [];
    const runner = createPostBlocksRunner(silentLogger, recordingSend(sent), async () => {
      throw new Error('db down');
    });

    const result = await runner.runPostBlocks(
      session,
      { text: 'Prices today', blocks: [{ kind: 'number', label: 'BTC', value: '$82,302' }] },
      { roomJid },
    );

    expect(result.content).toBe(
      'Your card was posted in this room. Do not repeat what it shows; reply with at most one short line.',
    );
    expect(sent).toHaveLength(1);
  });
});
