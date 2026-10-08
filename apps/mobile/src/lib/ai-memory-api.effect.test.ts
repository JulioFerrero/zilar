import { describe, expect, it, vi } from 'vitest';

import { createAiMemoryApi } from './ai-memory-api';

const MEMORY = {
  facts: [{ id: 'fact-1', text: 'Julio prefers short answers.' }],
  lines: ['#0-15 Summary: the team agreed on the launch plan and pricing.'],
  canChange: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ai memory schema', () => {
  it('drops unknown extra fields from the memory and its facts', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ...MEMORY,
        extra: 'ignored',
        facts: [{ ...MEMORY.facts[0], extra: 'ignored' }],
      }),
    );
    const api = createAiMemoryApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getMemory('chat', 'ai')).resolves.toEqual(MEMORY);
  });

  it('fails when a line is not a string', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ...MEMORY, lines: ['ok', 7] }));
    const api = createAiMemoryApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getMemory('chat', 'ai')).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
