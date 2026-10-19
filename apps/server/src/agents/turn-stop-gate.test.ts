// T-1422: a stop that lands while a turn awaits its budget gate must win over
// the gate's failure reply: the turn stays quiet and its card ends `stopped`.
import { describe, expect, it } from 'vitest';
import { runDmTurn } from './dm-turn';
import { runGroupTurn } from './group-turn';
import type { ExecuteToolCall } from './tool-loop';
import type { ChatToolDefinition } from '../ai/model-client';
import { type ModelTarget } from '../ai/providers';

const RECALL_TOOL: ChatToolDefinition = {
  type: 'function',
  function: {
    name: 'recall',
    description: 'Search my memory.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
};

const TARGET: ModelTarget = {
  provider: 'deepseek',
  apiKey: 'sk-placeholder-do-not-leak',
  model: 'deepseek-chat',
  apiUrl: 'http://127.0.0.1:1',
};

// The wall clock has already passed, so the loop exits with no text and the
// turn reaches its budget-gate branch without making a model call.
const PAST_TURN = { turnStartMs: 0, nowMs: () => 200_000 };

const executeTool: ExecuteToolCall = async () => ({ content: 'ok' });

describe('a stop during the budget gate ends the turn quietly (T-1422)', () => {
  it('group: no reply, no failure notice, the card finishes stopped', async () => {
    const controller = new AbortController();
    const sent: string[] = [];
    const finished: string[] = [];
    const failures: string[] = [];

    const outcome = await runGroupTurn({
      aiId: 'ai-1',
      roomJid: 'room@conference.zilar.localhost',
      triggerId: 'msg-1',
      senderJid: 'person@zilar.localhost',
      senderName: 'Person',
      messages: [{ role: 'user', content: 'hello' }],
      target: TARGET,
      ...PAST_TURN,
      tools: [RECALL_TOOL],
      executeTool,
      signal: controller.signal,
      checkRoundGate: async () => {
        // The owner stops the turn while the gate is being awaited.
        controller.abort();
        return { limited: true, reply: 'over budget' };
      },
      reportProgress: async () => null,
      finishProgress: async (state) => {
        finished.push(state);
      },
      onFailure: async (reason) => {
        failures.push(reason);
      },
      sendMessage: async (_to, _kind, text) => {
        sent.push(text);
      },
      sendTyping: () => undefined,
      logger: { warn: () => undefined },
    });

    expect(outcome).toEqual({ kind: 'stopped', text: '' });
    expect(sent).toEqual([]);
    expect(failures).toEqual([]);
    expect(finished).toEqual(['stopped']);
  });

  it('dm: no reply, the card finishes stopped', async () => {
    const controller = new AbortController();
    const sent: string[] = [];
    const finished: string[] = [];

    const outcome = await runDmTurn({
      aiId: 'ai-1',
      ownerJid: 'owner@zilar.localhost',
      messages: [{ role: 'user', content: 'hello' }],
      target: TARGET,
      ...PAST_TURN,
      tools: [RECALL_TOOL],
      executeTool,
      signal: controller.signal,
      checkRoundGate: async () => {
        // The owner stops the turn while the gate is being awaited.
        controller.abort();
        return { limited: true, reply: 'over budget' };
      },
      reportProgress: async () => null,
      finishProgress: async (state) => {
        finished.push(state);
      },
      sendMessage: async (_to, _kind, text) => {
        sent.push(text);
      },
      sendTyping: () => undefined,
      logger: { warn: () => undefined },
    });

    expect(outcome).toEqual({ kind: 'stopped', text: '' });
    expect(sent).toEqual([]);
    expect(finished).toEqual(['stopped']);
  });
});
