// The `/api/ai-memory` group (T-0940): the pinned facts and cover lines of one
// chat, with the same seed and mutations as web's mock (`apps/web/src/mock/
// api.ts` `seedAiMemory` and its `ai-memory` branch). `chat` is the peer's bare
// JID or a room JID; `ai` is the AI's id; the single mock user may change it.

import type { MockData } from '../state';
import { jsonResponse, notFound, readJsonBody, type MockHttpRequest } from './shared';

export function handleAiMemory(data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.segments[0] !== 'ai-memory') {
    return undefined;
  }
  const action = request.segments[1];
  const key = `${request.query.get('chat') ?? ''}|${request.query.get('ai') ?? ''}`;
  if (action === undefined && request.method === 'GET') {
    return jsonResponse({ ...data.aiMemoryFor(key), canChange: true });
  }
  if (action === 'facts' && request.method === 'DELETE') {
    const factId = decodeURIComponent(request.segments[2] ?? '');
    if (!data.removeAiFact(key, factId)) {
      return notFound('Fact not found');
    }
    return jsonResponse({ ok: true });
  }
  if (action === 'clear' && request.method === 'POST') {
    const body = readJsonBody(request.init);
    const chat = typeof body.chat === 'string' ? body.chat : '';
    const ai = typeof body.ai === 'string' ? body.ai : '';
    data.clearAiMemory(`${chat}|${ai}`);
    return jsonResponse({ ok: true });
  }
  return undefined;
}
