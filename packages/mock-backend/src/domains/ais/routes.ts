// The `/api/ais` group (T-0940): the owner's AIs, with the same bodies and
// mutations as web's mock (`apps/web/src/mock/api.ts` `createAi`/`patchAi`/
// `stopOrResumeAi`/`assignMachine`). The mock does not enforce the contract's
// create/edit bounds; the app's client decodes and the contract tests cover
// that, exactly like the old mock.

import type { AiCatalog, PublicAi } from '@zilar/api-contract';
import { isAiTemplate, readAiLimits } from './seed';
import type { MockData } from '../../state';
import { addChat } from '../directory/groups';
import {
  badRequest,
  conflict,
  jsonResponse,
  noContent,
  notFound,
  readJsonBody,
  type MockHttpRequest,
} from '../../http/shared';

export function handleAis(data: MockData, request: MockHttpRequest): Response | undefined {
  // T-1395: `/api/ai/catalog`, the wizard's model step in mock mode. GET only;
  // other methods fall through like every other route here.
  if (
    request.method === 'GET' &&
    request.segments[0] === 'ai' &&
    request.segments[1] === 'catalog'
  ) {
    return jsonResponse(MOCK_CATALOG);
  }
  if (request.segments[0] !== 'ais') {
    return undefined;
  }
  const aiId = request.segments[1];
  const action = request.segments[2];
  // T-1425: the Computer picker asks whether Zilar cloud desks are wired; the
  // mock always has them on. Static segment, so it answers before the `:id`
  // lookup below.
  if (aiId === 'computer-options' && action === undefined && request.method === 'GET') {
    return jsonResponse({ cloud: true });
  }
  if (aiId === undefined) {
    if (request.method === 'GET') return jsonResponse(data.ais);
    if (request.method === 'POST') return createAi(data, request);
    return undefined;
  }
  const ai = data.findAi(decodeURIComponent(aiId));
  if (ai === undefined) {
    return notFound('That AI no longer exists.');
  }
  // T-1422: stop the turn running in one chat, like the real route. The mock
  // has no live turn, so it answers as if one was running.
  if (action === 'turns' && request.segments[3] === 'stop' && request.method === 'POST') {
    return stopTurn(request);
  }
  if (action === 'stop' && request.method === 'POST') {
    return setStatus(data, ai, 'stopped');
  }
  if (action === 'resume' && request.method === 'POST') {
    return setStatus(data, ai, 'active');
  }
  if (action === 'machine' && request.method === 'PUT') {
    return assignMachine(data, ai, request);
  }
  if (action !== undefined) {
    return undefined;
  }
  if (request.method === 'GET') return jsonResponse(ai);
  if (request.method === 'PATCH') return patchAi(data, ai, request);
  if (request.method === 'DELETE') {
    data.removeAi(ai.id);
    return noContent();
  }
  return undefined;
}

// T-1422: `POST /api/ais/:id/turns/stop`. The mock keeps no running turn, so
// it accepts any non-empty `chatJid` and answers `{ stopped: true }`; the
// client shows "Stopping…" until the card's next edit (which a mock never
// sends).
function stopTurn(request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const chatJid = body.chatJid;
  if (typeof chatJid !== 'string' || chatJid.trim() === '') {
    return badRequest('invalid_request', 'chatJid is required');
  }
  return jsonResponse({ stopped: true });
}

function createAi(data: MockData, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const id = data.nextAiId();
  const name = typeof body.name === 'string' && body.name !== '' ? body.name : 'New AI';
  const created: PublicAi = {
    id,
    name,
    template: isAiTemplate(body.template) ? body.template : 'custom',
    persona: typeof body.persona === 'string' ? body.persona : '',
    model: typeof body.model === 'string' && body.model !== '' ? body.model : 'gpt-4o',
    jid: `ai-${id}@zilar.test`,
    status: 'active',
    providerConnectionId:
      typeof body.providerConnectionId === 'string' ? body.providerConnectionId : 'conn-openai',
    limits: readAiLimits(body.limits),
    lastFailure: null,
    machineId: null,
    computerMode: 'off',
    createdAt: new Date().toISOString(),
  };
  data.putAi(created);
  addChat(data, {
    kind: 'dm',
    chatJid: created.jid,
    title: created.name,
    isAi: true,
    // T-1474: the AI's chat carries its creation time so an empty new AI chat
    // leads the list, matching the real server.
    createdAt: created.createdAt,
  });
  return jsonResponse(created, 201);
}

function patchAi(data: MockData, ai: PublicAi, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  if (
    (body.computerMode === 'runner' || body.computerMode === 'auto') &&
    (ai.machineId === null || ai.machineId === undefined)
  ) {
    return badRequest('invalid_request', 'Runner and auto modes need an assigned machine');
  }
  const updated: PublicAi = {
    ...ai,
    ...(typeof body.name === 'string' ? { name: body.name } : {}),
    ...(typeof body.persona === 'string' ? { persona: body.persona } : {}),
    ...(typeof body.model === 'string' ? { model: body.model } : {}),
    ...(typeof body.providerConnectionId === 'string'
      ? { providerConnectionId: body.providerConnectionId }
      : {}),
    ...(body.limits === undefined ? {} : { limits: readAiLimits(body.limits) }),
    ...(typeof body.canDelegate === 'boolean' ? { canDelegate: body.canDelegate } : {}),
    ...(typeof body.acceptsDelegation === 'boolean'
      ? { acceptsDelegation: body.acceptsDelegation }
      : {}),
    ...(body.computerMode === 'off' ||
    body.computerMode === 'cloud' ||
    body.computerMode === 'runner' ||
    body.computerMode === 'auto'
      ? { computerMode: body.computerMode }
      : {}),
  };
  data.putAi(updated);
  return jsonResponse(updated);
}

// T-0080: stopped is the owner kill switch; a `disabled` AI is a 409
// `not_active`, and a no-op target answers the AI unchanged, like web's mock.
function setStatus(data: MockData, ai: PublicAi, target: 'stopped' | 'active'): Response {
  if (ai.status === target) {
    return jsonResponse(ai);
  }
  if (ai.status === 'disabled') {
    return conflict('not_active', 'AI is not active');
  }
  const updated: PublicAi = { ...ai, status: target };
  data.putAi(updated);
  return jsonResponse(updated);
}

function assignMachine(data: MockData, ai: PublicAi, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  if (!('machineId' in body)) {
    return badRequest('invalid_request', 'machineId is required');
  }
  const machineId = body.machineId;
  if (machineId !== null && typeof machineId !== 'string') {
    return badRequest('invalid_request', 'machineId must be a string or null');
  }
  if (machineId !== null && !isApprovedMachine(data, machineId)) {
    return notFound('Machine not found');
  }
  const updated: PublicAi = { ...ai, machineId };
  data.putAi(updated);
  // T-0091: an AI may only point at an approved machine; clear stale links.
  for (const item of data.ais) {
    const link = item.machineId;
    if (link !== null && link !== undefined && !isApprovedMachine(data, link)) {
      data.putAi({ ...item, machineId: null });
    }
  }
  return jsonResponse(updated);
}

function isApprovedMachine(data: MockData, machineId: string): boolean {
  return data.machines.some((machine) => machine.id === machineId && machine.status === 'approved');
}

// T-1395: a small, fixed catalog for the wizard's model step in mock mode.
// T-1442: the providers carry `kind` and `docUrl` like the real server, plus one
// OpenAI-compatible provider, so the New AI flow has something to show.
const MOCK_CATALOG: AiCatalog = {
  source: 'fallback',
  fetchedAt: '2026-10-14T00:00:00.000Z',
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      kind: 'native',
      docUrl: 'https://platform.openai.com/docs',
      models: [
        {
          id: 'gpt-4o-mini',
          name: 'GPT-4o mini',
          contextTokens: 128000,
          inputPricePerMTok: 0.15,
          outputPricePerMTok: 0.6,
          toolCalls: true,
          reasoning: false,
          releaseDate: '2024-07-18',
        },
        {
          id: 'gpt-4o',
          name: 'GPT-4o',
          contextTokens: 128000,
          inputPricePerMTok: 2.5,
          outputPricePerMTok: 10,
          toolCalls: true,
          reasoning: false,
          releaseDate: '2024-05-13',
        },
      ],
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      kind: 'native',
      docUrl: 'https://docs.anthropic.com',
      models: [
        {
          id: 'claude-sonnet-4-5',
          name: 'Claude Sonnet 4.5',
          contextTokens: 200000,
          inputPricePerMTok: 3,
          outputPricePerMTok: 15,
          toolCalls: true,
          reasoning: true,
          releaseDate: '2025-09-29',
        },
      ],
    },
    {
      id: 'google',
      name: 'Google',
      kind: 'native',
      docUrl: 'https://ai.google.dev/gemini-api/docs',
      models: [
        {
          id: 'gemini-2.5-flash',
          name: 'Gemini 2.5 Flash',
          contextTokens: 1048576,
          inputPricePerMTok: 0.3,
          outputPricePerMTok: 2.5,
          toolCalls: true,
          reasoning: true,
          releaseDate: '2025-06-17',
        },
      ],
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      kind: 'native',
      docUrl: 'https://api-docs.deepseek.com',
      models: [
        {
          id: 'deepseek-chat',
          name: 'DeepSeek Chat',
          contextTokens: 128000,
          inputPricePerMTok: 0.27,
          outputPricePerMTok: 1.1,
          toolCalls: true,
          reasoning: false,
          releaseDate: '2025-01-01',
        },
      ],
    },
    {
      id: 'xai',
      name: 'xAI',
      kind: 'native',
      docUrl: 'https://docs.x.ai',
      models: [
        {
          id: 'grok-4',
          name: 'Grok 4',
          contextTokens: 256000,
          inputPricePerMTok: 3,
          outputPricePerMTok: 15,
          toolCalls: true,
          reasoning: true,
          releaseDate: '2025-07-09',
        },
      ],
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      kind: 'native',
      docUrl: 'https://openrouter.ai/docs',
      models: [
        {
          id: 'openai/gpt-4o',
          name: 'GPT-4o',
          contextTokens: 128000,
          inputPricePerMTok: 2.5,
          outputPricePerMTok: 10,
          toolCalls: true,
          reasoning: false,
          releaseDate: '2024-05-13',
        },
      ],
    },
    {
      id: 'together',
      name: 'Together AI',
      kind: 'compatible',
      docUrl: 'https://docs.together.ai',
      models: [
        {
          id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
          name: 'Llama 3.3 70B Turbo',
          contextTokens: 131072,
          inputPricePerMTok: 0.88,
          outputPricePerMTok: 0.88,
          toolCalls: true,
          reasoning: false,
          releaseDate: '2024-12-06',
        },
      ],
    },
  ],
};
