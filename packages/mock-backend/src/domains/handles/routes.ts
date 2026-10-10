// Handles routes (T-1067): the live availability check, mirroring web's mock
// (`apps/web/src/mock/api.ts:1739-1746`). The check reads no table, so this
// domain has no state; the claim (`PUT /me/handle`) lives in the `me` domain,
// because it writes the viewer row.

import type { HandleCheck } from '@zilar/api-contract';
import { jsonResponse, type MockHttpRequest } from '../../http/shared';
import type { MockData } from '../../state';
import { checkHandle } from './check';

export function handleHandles(_data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, first] = request.segments;
  if (head !== 'handles' || first !== 'check' || request.segments.length !== 2) {
    return undefined;
  }
  if (request.method !== 'GET') {
    return undefined;
  }
  return jsonResponse(check(request));
}

function check(request: MockHttpRequest): HandleCheck {
  const raw = (request.query.get('handle') ?? '').trim();
  // `kind=group` reports the demo group's `@acme` as taken, like web's mock.
  if (request.query.get('kind') === 'group' && raw.toLowerCase() === 'acme') {
    return { available: false, reason: 'taken' };
  }
  return checkHandle(raw);
}
