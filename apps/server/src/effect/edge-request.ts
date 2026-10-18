// Route matching, request id, CORS, the request-log path and the error bodies
// for the edge. This file must not import `./edge.ts` (no cycle).

import { HttpServerResponse } from 'effect/http';
import type { ServerConfig } from '../config';
import { HttpError } from '../errors';
import { REQUEST_ID_HEADER, SOCKET_ADDRESS_HEADER } from './http-core';

const REQUEST_ID_RESPONSE_HEADER = 'X-Request-Id';
const REQUEST_ID_LIMIT = 255;
const REQUEST_ID_PATTERN = /[^\w\-=]/;

const CORS_ALLOW_METHODS = 'GET,HEAD,PUT,POST,DELETE,PATCH,QUERY';

export interface CompiledRoute {
  readonly method: string;
  readonly segments: ReadonlyArray<string>;
  readonly handler: (request: Request) => Promise<Response>;
}

export function splitPattern(path: string): ReadonlyArray<string> {
  return path.split('/').slice(1);
}

export function splitPathname(pathname: string): ReadonlyArray<string> {
  return pathname.split('/').slice(1).map(decodeSegment);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function matchesRoute(route: CompiledRoute, segments: ReadonlyArray<string>): boolean {
  if (route.segments.length !== segments.length) {
    return false;
  }
  for (let index = 0; index < route.segments.length; index += 1) {
    const pattern = route.segments[index];
    if (pattern === undefined || pattern.startsWith(':')) {
      continue;
    }
    if (pattern !== segments[index]) {
      return false;
    }
  }
  return true;
}

export function resolveRequestId(inbound: string | null): string {
  if (
    inbound !== null &&
    inbound.length > 0 &&
    inbound.length <= REQUEST_ID_LIMIT &&
    !REQUEST_ID_PATTERN.test(inbound)
  ) {
    return inbound;
  }
  return crypto.randomUUID();
}

export const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function allowedOrigins(config: ServerConfig): string[] {
  const origins = new Set(config.WEB_ORIGINS);
  origins.add(new URL(config.PUBLIC_URL).origin);
  origins.add(new URL(config.BETTER_AUTH_URL).origin);
  return [...origins];
}

// Join tokens, invite codes, GIF media tokens and avatar ids are bearer
// secrets, so the log redacts the segment after each, including a trailing-slash
// variant that 404s in routing but still reaches this line.
export function logPath(path: string): string {
  if (path.startsWith('/api/join/')) {
    return '/api/join/:token';
  }
  if (path.startsWith('/api/gifs/media/')) {
    return '/api/gifs/media/:token';
  }
  if (path.startsWith('/api/avatars/')) {
    return '/api/avatars/:id';
  }
  return path.startsWith('/api/invites/') ? '/api/invites/:code' : path;
}

export function durationSince(start: number): number {
  return Math.round(performance.now() - start);
}

export function errorBody(requestId: string, error: HttpError): unknown {
  return {
    error: {
      ...error.detail,
      code: error.code,
      message: error.message,
      requestId,
    },
  };
}

export function internalErrorBody(requestId: string): unknown {
  return {
    error: {
      code: 'internal_error',
      message: 'Internal server error',
      requestId,
    },
  };
}

function appendVary(
  response: HttpServerResponse.HttpServerResponse,
  value: string,
): HttpServerResponse.HttpServerResponse {
  const existing = response.headers['vary'];
  if (existing === undefined) {
    return HttpServerResponse.setHeader('Vary', value)(response);
  }
  const values = existing.split(',').map((entry) => entry.trim());
  if (values.includes(value)) {
    return response;
  }
  return HttpServerResponse.setHeader('Vary', `${existing}, ${value}`)(response);
}

// An allowed origin is echoed, credentials are always on, and `Vary: Origin` is
// set on every response. A disallowed or absent origin gets no allow-origin
// header but keeps the credentials flag, as before.
export function applyCors(
  response: HttpServerResponse.HttpServerResponse,
  allowedOrigin: string | null,
  preflightHeaders: string | undefined,
  preflight: boolean,
): HttpServerResponse.HttpServerResponse {
  let result = response;
  if (allowedOrigin !== null) {
    result = HttpServerResponse.setHeader('Access-Control-Allow-Origin', allowedOrigin)(result);
  }
  result = HttpServerResponse.setHeader('Access-Control-Allow-Credentials', 'true')(result);
  if (preflight) {
    result = HttpServerResponse.setHeader(
      'Access-Control-Allow-Methods',
      CORS_ALLOW_METHODS,
    )(result);
    if (preflightHeaders !== undefined && preflightHeaders.length > 0) {
      const headers = preflightHeaders
        .split(',')
        .map((header) => header.trim())
        .filter((header) => header.length > 0)
        .join(',');
      if (headers.length > 0) {
        result = HttpServerResponse.setHeader('Access-Control-Allow-Headers', headers)(result);
        result = appendVary(result, 'Access-Control-Request-Headers');
      }
    }
  }
  return appendVary(result, 'Origin');
}

export function withRequestIdHeader(
  response: HttpServerResponse.HttpServerResponse,
  requestId: string,
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.setHeader(REQUEST_ID_RESPONSE_HEADER, requestId)(response);
}

export function mergePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

export function forwardEdgeRequest(
  request: Request,
  requestId: string,
  socketAddress: string,
): Request {
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  // Only the edge may set it.
  headers.delete(SOCKET_ADDRESS_HEADER);
  headers.set(SOCKET_ADDRESS_HEADER, socketAddress);
  return new Request(request, { headers });
}
