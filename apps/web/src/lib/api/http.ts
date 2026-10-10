import { Exit, Schema } from 'effect';
import { ApiError, apiErrorFromBody } from '@zilar/api-contract';
import { isMockApiEnabled } from '@/mock/gate';
import { loadMockRequest } from '@/mock/load';

/** Base path for the server API. The Vite dev server proxies it same-origin. */
export const API_BASE = '/api';

// One error class for every call, hand-written or derived from the contract.
export { ApiError };

type ResponseSchema<T> = Schema.Codec<T, unknown>;

/**
 * Decodes one response body with an Effect Schema. The decode is
 * non-strict (unknown keys are dropped).
 */
export function decodeResponse<T>(
  schema: ResponseSchema<T>,
  raw: unknown,
): { ok: true; value: T } | { ok: false } {
  const result = Schema.decodeUnknownExit(schema)(raw);
  return Exit.isSuccess(result) ? { ok: true, value: result.value } : { ok: false };
}

export async function request<T>(
  path: string,
  schema: ResponseSchema<T>,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  if (isMockApiEnabled()) {
    // Standalone mock mode: answer locally, never touch the network (T-0069).
    response = await (await loadMockRequest())(path, init);
  } else {
    try {
      const headers = new Headers(init.headers);
      if (!headers.has('Accept')) {
        headers.set('Accept', 'application/json');
      }
      response = await fetch(`${API_BASE}${path}`, {
        credentials: 'same-origin',
        ...init,
        headers,
      });
    } catch {
      throw new ApiError(0, 'network_error', 'Could not reach the server');
    }
  }

  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw apiErrorFromBody(response.status, raw);
  }

  const parsed = decodeResponse(schema, raw);
  if (!parsed.ok) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The server sent an unexpected response',
    );
  }
  return parsed.value;
}

/**
 * Posts one prepared file as raw bytes (not multipart) and decodes the reply.
 * Shared by the sticker, avatar and background uploads, which used to carry
 * three copies of this block. Extra headers (e.g. `x-emoji`) ride `headers`.
 */
export async function uploadBytes<T>(
  method: 'POST' | 'PUT',
  path: string,
  blob: Blob,
  schema: ResponseSchema<T>,
  headers: Record<string, string> = {},
): Promise<T> {
  const body = { 'Content-Type': blob.type, ...headers };
  let response: Response;
  if (isMockApiEnabled()) {
    response = await (
      await loadMockRequest()
    )(path, {
      method,
      headers: body,
      body: blob as unknown as string,
    });
  } else {
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        credentials: 'same-origin',
        headers: body,
        body: blob,
      });
    } catch {
      throw new ApiError(0, 'network_error', 'Could not reach the server');
    }
  }
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw apiErrorFromBody(response.status, raw);
  }
  const parsed = decodeResponse(schema, raw);
  if (!parsed.ok) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The server sent an unexpected response',
    );
  }
  return parsed.value;
}
