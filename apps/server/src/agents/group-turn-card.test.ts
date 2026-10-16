// T-1761: the message pipeline facts Julio asked for. A group tool turn whose
// call posted a card sends no echo reply, and a plain group reply no longer
// tags the asker with `@name` while still quoting the trigger.
import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../ai/http';
import type { ModelTarget } from '../ai/model-client';
import { runGroupTurn } from './group-turn';
import type { ChatToolDefinition } from './tools';

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
