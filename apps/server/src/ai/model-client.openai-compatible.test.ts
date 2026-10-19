// T-1396: a model call to a custom OpenAI-compatible provider goes to
// `{baseUrl}/chat/completions` with the bearer key and streams the reply. The
// fake server is the one `dm-turn.fake-provider.test.ts` uses. The call is
// driven through `chat()` so the pinned fetch is the one under test: tests
// inject the resolver / allow-private hook (`pinnedFetchOptions`), never a
// replacement fetch.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { chat, ChatCompletionError } from './model-client';
import { type ModelTarget } from './providers';

const API_KEY = 'sk-fake-custom-key';
const LOCALHOST = { resolver: async () => ['127.0.0.1'], allowBlockedAddresses: true };

interface CapturedRequest {
  url: string | undefined;
  authorization: string | undefined;
  body: string;
}

function textEvents(content: string): string {
  return [
    `data: ${JSON.stringify({
      id: 'chatcmpl-fake',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'fake',
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: 'chatcmpl-fake',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'fake',
      choices: [],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
}

function startFakeProvider(
  requests: CapturedRequest[],
): Promise<{ server: Server; apiUrl: string }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (part: Buffer) => chunks.push(part));
    req.on('end', () => {
      requests.push({
        url: req.url,
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
      res.end(textEvents('Hello there.'));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, apiUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function target(apiUrl: string | undefined): ModelTarget {
  return {
    provider: 'openai-compatible',
    apiKey: API_KEY,
    model: 'llama-3.1-8b-instant',
    ...(apiUrl === undefined ? {} : { apiUrl }),
  };
}

describe('chat against a custom OpenAI-compatible provider', () => {
  it('posts to /chat/completions with the key through the pinned fetch', async () => {
    const requests: CapturedRequest[] = [];
    const { server, apiUrl } = await startFakeProvider(requests);
    try {
      const result = await chat({
        target: target(apiUrl),
        messages: [{ role: 'user', content: 'hello' }],
        pinnedFetchOptions: LOCALHOST,
      });

      expect(result.content).toBe('Hello there.');
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe('/chat/completions');
      expect(requests[0]?.authorization).toBe(`Bearer ${API_KEY}`);
      expect(requests[0]?.body).toContain('llama-3.1-8b-instant');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('ignores a caller-supplied fetchImpl for a custom provider', async () => {
    const requests: CapturedRequest[] = [];
    const { server, apiUrl } = await startFakeProvider(requests);
    let replaced = false;
    try {
      const result = await chat({
        target: target(apiUrl),
        messages: [{ role: 'user', content: 'hello' }],
        // A future caller passing a fetch must not drop the SSRF guard.
        fetchImpl: () => {
          replaced = true;
          return Promise.reject(new Error('the pinned fetch must win'));
        },
        pinnedFetchOptions: LOCALHOST,
      });

      expect(replaced).toBe(false);
      expect(result.content).toBe('Hello there.');
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe('/chat/completions');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('fails when a custom provider has no base URL', async () => {
    await expect(
      chat({ target: target(undefined), messages: [{ role: 'user', content: 'hello' }] }),
    ).rejects.toThrow('openai-compatible requires a base URL');
  });

  // The pinned fetch never follows a 3xx; this proves the Effect client that
  // consumes it does not follow one either (it filters non-2xx before touching
  // the body). A followed redirect would be a request to a second path here.
  it('does not follow a redirect from the custom provider', async () => {
    const paths: string[] = [];
    const server = createServer((req, res) => {
      paths.push(req.url ?? '');
      if (req.url === '/chat/completions') {
        res.writeHead(302, { location: '/steal' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const error = await chat({
        target: target(`http://127.0.0.1:${port}`),
        messages: [{ role: 'user', content: 'hello' }],
        pinnedFetchOptions: LOCALHOST,
      }).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(ChatCompletionError);
      expect((error as ChatCompletionError).status).toBe(302);
      expect(paths).toEqual(['/chat/completions']);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
