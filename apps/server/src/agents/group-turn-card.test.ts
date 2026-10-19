// T-1761: the message pipeline facts Julio asked for. A group tool turn whose
// call posted a card sends no echo reply, and a plain group reply no longer
// tags the asker with `@name` while still quoting the trigger.
import type { XmppCore } from '@zilar/xmpp-core';
import { describe, expect, it } from 'vitest';
import type { ActionGateway } from '../actions/gateway';
import type { FetchLike } from '../ai/http';
import type { AiSession } from './gateway/contracts';
import { createRequestActionRunner } from './gateway/tool-exec';
import { runGroupTurn } from './group-turn';
import { REQUEST_ACTION_TOOL } from './tools/schemas';
import { buildRequestActionTool } from './tools/definitions';
import type { ChatToolDefinition } from '../ai/model-client';
import { type ModelTarget } from '../ai/providers';

const TARGET: ModelTarget = {
  provider: 'deepseek',
  apiKey: 'sk-placeholder-do-not-leak',
  model: 'deepseek-chat',
  apiUrl: 'http://127.0.0.1:1',
};

const POST_BLOCKS: ChatToolDefinition = {
  type: 'function',
  function: {
    name: 'post_blocks',
    description: 'Post a card into the room.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        blocks: { type: 'array' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
};

// Minimal OpenAI-compatible SSE fakes, copied from the gateway test harness so
// this unit test needs no database.
function sse(events: readonly string[]): Response {
  return new Response(events.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function chunk(delta: Record<string, unknown>, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function completion(content: string): Response {
  return sse([chunk({ content }, null), chunk({}, 'stop'), 'data: [DONE]\n\n']);
}

function toolCall(name: string, argsJson: string): Response {
  return sse([
    chunk(
      {
        tool_calls: [
          { index: 0, id: 'call-1', type: 'function', function: { name, arguments: argsJson } },
        ],
      },
      'tool_calls',
    ),
    'data: [DONE]\n\n',
  ]);
}

// A minimal live session, the same shape the other gateway unit tests build:
// `request-action.ts` reads only `aiId` and `aiJid` off it.
function sessionFor(): AiSession {
  return {
    aiId: 'ai-1',
    aiJid: 'ai-1@zilar.localhost',
    core: {} as XmppCore,
    busy: false,
    pending: [],
    stopped: false,
    retryAttempt: 0,
    retryTimer: undefined,
    unsubs: [],
    turnAborts: new Map(),
    rooms: new Map(),
    roomPending: new Map(),
    roomBusy: new Set(),
    roomTurns: new Map(),
    roomRateNotices: new Map(),
    roomSentIds: new Map(),
  };
}

describe('a group turn that posted a card sends no echo reply (T-1761)', () => {
  it('post_blocks with postedToRoom ends quietly with the card done', async () => {
    const sent: string[] = [];
    const finished: string[] = [];
    let modelCalls = 0;
    const fetchImpl: FetchLike = () => {
      modelCalls += 1;
      return Promise.resolve(
        toolCall(
          'post_blocks',
          '{"text":"prices","blocks":[{"kind":"number","label":"BTC","value":"$1"}]}',
        ),
      );
    };

    const outcome = await runGroupTurn({
      aiId: 'ai-1',
      roomJid: 'room@conference.zilar.localhost',
      triggerId: 'msg-1',
      senderJid: 'person@zilar.localhost',
      senderName: 'Person',
      messages: [{ role: 'user', content: 'post the prices as a card' }],
      target: TARGET,
      fetchImpl,
      tools: [POST_BLOCKS],
      executeTool: async () => ({ content: 'your card was posted', postedToRoom: true }),
      finishProgress: async (state) => {
        finished.push(state);
      },
      sendMessage: async (_to, _kind, text) => {
        sent.push(text);
      },
      sendTyping: () => undefined,
      logger: { warn: () => undefined },
    });

    expect(outcome).toEqual({ kind: 'replied', text: '' });
    expect(sent).toEqual([]);
    expect(modelCalls).toBe(1);
    expect(finished).toEqual(['done']);
  });
});

describe('a group reply quotes the asker without the @name tag (T-1761)', () => {
  it('wires the answer with replyTo on the trigger and no leading mention', async () => {
    const replies: Array<{ text: string; opts: unknown }> = [];
    const fetchImpl: FetchLike = () => Promise.resolve(completion('Hello there'));

    const outcome = await runGroupTurn({
      aiId: 'ai-1',
      roomJid: 'room@conference.zilar.localhost',
      triggerId: 'msg-1',
      senderJid: 'person@zilar.localhost',
      senderName: 'Person',
      messages: [{ role: 'user', content: 'hi' }],
      target: TARGET,
      fetchImpl,
      sendMessage: async (_to, _kind, text, opts) => {
        replies.push({ text, opts });
      },
      sendTyping: () => undefined,
      logger: { warn: () => undefined },
    });

    expect(outcome).toEqual({ kind: 'replied', text: 'Hello there' });
    expect(replies).toHaveLength(1);
    const reply = replies[0];
    expect(reply?.text).toBe('Hello there');
    expect(reply?.text.startsWith('@')).toBe(false);
    const opts = reply?.opts as { replyTo?: { id?: string }; mentions?: unknown[] } | undefined;
    expect(opts?.replyTo).toEqual({ id: 'msg-1' });
    expect(opts?.mentions).toEqual([]);
  });
});

// T-1763: the `posted` → `postedToRoom` → no-echo link, exercised through the
// real `request_action` mapping instead of a hand-written tool result: an
// `executed` outcome with `posted: true` must end the turn with no reply.
describe('a request_action that posted a card sends no echo reply (T-1763)', () => {
  it('maps an executed+posted outcome to postedToRoom and stays quiet', async () => {
    const sent: string[] = [];
    let requests = 0;
    const actions: ActionGateway = {
      request: () => {
        requests += 1;
        return Promise.resolve({ status: 'executed', summary: 'posted a card', posted: true });
      },
      onApprovalDecided: () => Promise.resolve(),
      recoverStuck: () => Promise.resolve(),
      listActions: () => [],
    };
    const session = sessionFor();
    const { runRequestAction } = createRequestActionRunner(actions, {
      info: () => undefined,
      warn: () => undefined,
    });
    const fetchImpl: FetchLike = () =>
      Promise.resolve(toolCall('request_action', '{"action":"market.prices","args":{}}'));

    const outcome = await runGroupTurn({
      aiId: 'ai-1',
      aiJid: session.aiJid,
      roomJid: 'room@conference.zilar.localhost',
      triggerId: 'msg-1',
      senderJid: 'person@zilar.localhost',
      senderName: 'Person',
      messages: [{ role: 'user', content: 'post the prices as a card' }],
      target: TARGET,
      fetchImpl,
      tools: [buildRequestActionTool([{ name: 'market.prices', description: 'Prices' }])],
      executeTool: (call) =>
        call.tool === REQUEST_ACTION_TOOL
          ? runRequestAction(session, call, { groupId: 'g-1', topicId: 't-1' })
          : Promise.resolve({ content: 'invalid: unknown tool' }),
      sendMessage: async (_to, _kind, text) => {
        sent.push(text);
      },
      sendTyping: () => undefined,
      logger: { warn: () => undefined },
    });

    expect(requests).toBe(1);
    expect(outcome).toEqual({ kind: 'replied', text: '' });
    expect(sent).toEqual([]);
  });
});
