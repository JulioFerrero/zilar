// The `/api/connections` group (T-0940): the provider keys a user lets their
// AIs use, with the same bodies and mutations as web's mock
// (`apps/web/src/mock/api.ts` `createConnection` and its `connections` branch).
// A key is write-only: no response carries one, and the mock never stores it.

import type { ConnectionView } from '@zilar/api-contract';
import type { MockData } from '../../state';
import {
  jsonResponse,
  noContent,
  notFound,
  readJsonBody,
  type MockHttpRequest,
} from '../../http/shared';

export function handleConnections(data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.segments[0] !== 'connections') {
    return undefined;
  }
  const connectionId = request.segments[1];
  const action = request.segments[2];
  if (connectionId === undefined) {
    if (request.method === 'GET') return jsonResponse(data.connections);
    if (request.method === 'POST') return createConnection(data, request);
    return undefined;
  }
  const id = decodeURIComponent(connectionId);
  if (action === 'test' && request.method === 'POST') {
    if (!data.hasConnection(id)) {
      return notFound('No such connection.');
    }
    return jsonResponse({ ok: true });
  }
  if (action !== undefined) {
    return undefined;
  }
  if (request.method === 'DELETE') {
    if (!data.hasConnection(id)) {
      return notFound('No such connection.');
    }
    data.removeConnection(id);
    return noContent();
  }
  return undefined;
}

function createConnection(data: MockData, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const created: ConnectionView = {
    id: data.nextConnectionId(),
    provider: typeof body.provider === 'string' && body.provider !== '' ? body.provider : 'openai',
    label: typeof body.label === 'string' && body.label !== '' ? body.label : null,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  data.putConnection(created);
  return jsonResponse(created, 201);
}
