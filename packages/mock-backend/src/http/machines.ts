// The `/api/machines` group (T-0940): runner pairing, the owner's machines and
// their approve/deny/revoke/rename/delete flow, with the same bodies and
// mutations as web's mock (`apps/web/src/mock/api.ts` `createPairingCodeResponse`
// and its `machines` branch). Revoking clears the AI home-machine link (T-0091).

import type { MockData } from '../state';
import {
  conflict,
  jsonResponse,
  noContent,
  notFound,
  readJsonBody,
  type MockHttpRequest,
} from './shared';

export function handleMachines(data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.segments[0] !== 'machines') {
    return undefined;
  }
  const machineId = request.segments[1];
  const action = request.segments[2];
  if (machineId === undefined) {
    if (request.method === 'GET') return jsonResponse(data.machines);
    return undefined;
  }
  if (machineId === 'pairing-codes' && action === undefined) {
    if (request.method === 'POST') return jsonResponse(createPairingCode(), 201);
    return undefined;
  }
  const machine = data.findMachine(decodeURIComponent(machineId));
  if (machine === undefined) {
    return notFound('Machine not found');
  }
  if (action === 'approve' && request.method === 'POST') {
    if (machine.status !== 'pending') {
      return conflict('invalid_transition', 'Only pending machines can be approved');
    }
    return jsonResponse(
      data.putMachine({ ...machine, status: 'approved', approvedAt: new Date().toISOString() }),
    );
  }
  if (action === 'deny' && request.method === 'POST') {
    if (machine.status !== 'pending') {
      return conflict('invalid_transition', 'Only pending machines can be denied');
    }
    data.removeMachine(machine.id);
    return noContent();
  }
  if (action === 'revoke' && request.method === 'POST') {
    if (machine.status === 'revoked') {
      return conflict('invalid_transition', 'Machine is already revoked');
    }
    const revoked = data.putMachine({ ...machine, status: 'revoked' });
    data.detachMachine(machine.id);
    return jsonResponse(revoked);
  }
  if (action !== undefined) {
    return undefined;
  }
  if (request.method === 'PATCH') {
    const body = readJsonBody(request.init);
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return conflict('invalid_request', 'Name is required');
    }
    return jsonResponse(data.putMachine({ ...machine, name: body.name }));
  }
  if (request.method === 'DELETE') {
    if (machine.status === 'approved') {
      return conflict('revoke_first', 'Revoke the machine before deleting it');
    }
    data.removeMachine(machine.id);
    return noContent();
  }
  return undefined;
}

/** A throwaway pairing code, shaped like web's mock (`ABCD-EFGH`, 10 minutes). */
function createPairingCode(): { code: string; expiresAt: string } {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = (): string => {
    let value = '';
    for (let i = 0; i < 4; i += 1) {
      value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return value;
  };
  return {
    code: `${block()}-${block()}`,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
}
