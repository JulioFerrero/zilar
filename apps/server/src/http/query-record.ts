// The raw query view shared by the files, media and gifs handlers (T-2058).

import type { HttpServerRequest } from 'effect/http';

// Strict, so an excess key fails like the old zod `.strict()`.
export const STRICT_QUERY = { onExcessProperty: 'error' } as const;

export function queryRecord(request: HttpServerRequest.HttpServerRequest): Record<string, string> {
  const queryIndex = request.originalUrl.indexOf('?');
  if (queryIndex === -1) {
    return {};
  }
  const params = new URLSearchParams(request.originalUrl.slice(queryIndex + 1));
  const record: Record<string, string> = {};
  for (const [key, value] of params) {
    if (!(key in record)) {
      record[key] = value;
    }
  }
  return record;
}
