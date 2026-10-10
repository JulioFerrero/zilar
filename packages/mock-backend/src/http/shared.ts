// effect-plain: in-memory mock backend; a bad JSON body is ignored, not an error

// Shared pieces of the mock HTTP layer: the request a route sees, the response
// helpers, and the default delay. `parseRequest` strips a leading `/api`, so the
// hand-written web calls (`/chats`) and the contract client's calls
// (`/api/chats`) both match.
import type { MockData } from '../state';

export const DEFAULT_DELAY_MS = 150;

export interface MockHttpRequest {
  readonly path: string;
  readonly method: string;
  readonly segments: readonly string[];
  readonly query: URLSearchParams;
  readonly init: RequestInit;
}

export type MockRoute = (data: MockData, request: MockHttpRequest) => Response | undefined;

export function parseRequest(path: string, init: RequestInit): MockHttpRequest {
  const method = (init.method ?? 'GET').toUpperCase();
  const raw = path.startsWith('/') ? path : `/${path}`;
  const withoutBase = raw.startsWith('/api/') ? raw.slice(4) : raw;
  const queryAt = withoutBase.indexOf('?');
  const pathname = queryAt === -1 ? withoutBase : withoutBase.slice(0, queryAt);
  const search = queryAt === -1 ? '' : withoutBase.slice(queryAt + 1);
  return {
    path,
    method,
    segments: pathname.split('/').filter((part) => part !== ''),
    query: new URLSearchParams(search),
    init,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function readJsonBody(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== 'string' || init.body === '') {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(init.body);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
