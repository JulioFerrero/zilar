// The `/api/ais` group (T-0940): the owner's AIs, with the same bodies and
// mutations as web's mock (`apps/web/src/mock/api.ts` `createAi`/`patchAi`/
// `stopOrResumeAi`/`assignMachine`). The mock does not enforce the contract's
// create/edit bounds; the app's client decodes and the contract tests cover
// that, exactly like the old mock.

import type { PublicAi } from '@zilar/api-contract';
import { isAiTemplate, readAiLimits } from './seed';
import type { MockData } from '../../state';
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
  if (request.segments[0] !== 'ais') {
    return undefined;
  }
  const aiId = request.segments[1];
  const action = request.segments[2];
  if (aiId === undefined) {
    if (request.method === 'GET') return jsonResponse(data.ais);
    if (request.method === 'POST') return createAi(data, request);
    return undefined;
  }
  const ai = data.findAi(decodeURIComponent(aiId));
  if (ai === undefined) {
    return notFound('That AI no longer exists.');
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
    machineId: null,
    createdAt: new Date().toISOString(),
  };
  data.putAi(created);
  return jsonResponse(created, 201);
}

function patchAi(data: MockData, ai: PublicAi, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
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
