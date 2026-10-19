// The P0 acceptance in code: a DM answered end to end through Effect AI against
// a local OpenAI-compatible server — one tool round and a final text.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { ChatUsage } from '../ai/model-client';
import { runDmTurn } from './dm-turn';
import type { ChatToolDefinition } from '../ai/model-client';
import type { ExecuteToolCall } from './tool-loop';
import { type ModelTarget } from '../ai/providers';

const API_KEY = 'sk-fake-provider-key';

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

interface CapturedRequest {
  authorization: string | undefined;
  body: string;
}

function chunk(delta: Record<string, unknown>, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'deepseek-chat',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function usageLine(): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'deepseek-chat',
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  })}\n\n`;
}

function toolCallEvents(id: string, name: string, argsJson: string): string {
  return [
    chunk(
      {
        tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: argsJson } }],
      },
      'tool_calls',
    ),
    usageLine(),
    'data: [DONE]\n\n',
  ].join('');
}

function textEvents(content: string): string {
  return [chunk({ content }, null), chunk({}, 'stop'), usageLine(), 'data: [DONE]\n\n'].join('');
}

// A minimal OpenAI-compatible chat-completions server: the first call gets one
// tool call, the follow-up (which carries a `tool` message) gets the final text.
function startFakeProvider(
  requests: CapturedRequest[],
): Promise<{ server: Server; apiUrl: string }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (part: Buffer) => chunks.push(part));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ authorization: req.headers.authorization, body });
      const parsed = JSON.parse(body) as { messages?: Array<{ role?: string }> };
      const answered = (parsed.messages ?? []).some((message) => message.role === 'tool');
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        connection: 'close',
      });
      res.end(
        answered
          ? textEvents('The answer is 42.')
          : toolCallEvents('call-1', 'recall', '{"query":"cats"}'),
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, apiUrl: `http://127.0.0.1:${port}` });
    });
  });
}

describe('runDmTurn against a fake OpenAI-compatible provider', () => {
  it('answers with one tool round and reports usage and the bearer key', async () => {
    const requests: CapturedRequest[] = [];
    const { server, apiUrl } = await startFakeProvider(requests);
    try {
      const target: ModelTarget = {
        provider: 'deepseek',
        apiKey: API_KEY,
        model: 'deepseek-chat',
        apiUrl,
      };
      const sent: string[] = [];
      const usages: ChatUsage[] = [];
      const toolNames: string[] = [];
      const executeTool: ExecuteToolCall = async (call) => {
        toolNames.push(call.tool);
        return { content: 'ok' };
      };

      const outcome = await runDmTurn({
        aiId: 'ai-1',
        ownerJid: 'owner@zilar.localhost',
        messages: [{ role: 'user', content: 'what do you remember?' }],
        target,
        tools: [RECALL_TOOL],
        executeTool,
        onUsage: (usage) => usages.push(usage),
        sendMessage: async (_to, _kind, text) => {
          sent.push(text);
        },
        sendTyping: () => undefined,
        logger: { warn: () => undefined },
      });

      expect(outcome).toEqual({ kind: 'replied', text: 'The answer is 42.' });
      expect(sent).toEqual(['The answer is 42.']);
      // The tool round ran exactly once, through the real loop.
      expect(toolNames).toEqual(['recall']);
      // Usage arrives from the stream's finish part.
      expect(usages.length).toBeGreaterThanOrEqual(1);
      expect(usages[0]).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      // Two model calls: the tool round and the final text.
      expect(requests).toHaveLength(2);
      expect(requests[0]?.authorization).toBe(`Bearer ${API_KEY}`);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
