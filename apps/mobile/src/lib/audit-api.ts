import { Data, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { errorFieldsOf } from './api-error-body';
import { API_URL } from './auth';

/**
 * The AI activity read API (`GET /api/audit?aiId=…`), the mobile twin of the
 * web client in `apps/web/src/lib/api.ts` (`listAudit`). The wire contract
 * lives in `apps/server/src/audit/api.ts`.
 *
 * The boundary is validated with Effect Schema (T-0506 recipe): the request is
 * an Effect pipeline, cut back to a `Promise` at the edge with
 * `Effect.runPromise`. `AuditApiError` keeps the server's `code` and `status`,
 * so the section can show fixed user-facing sentences instead of server text.
 */

export type AuditResult = 'ok' | 'denied' | 'error';

export interface AuditCost {
  currency: 'EUR' | 'USD';
  amount: number;
}

export interface PublicAuditEntry {
  id: string;
  at: string;
  aiId: string | null;
  groupId: string | null;
  action: string;
  subjectId: string | null;
  argsHash: string | null;
  cost: AuditCost | null;
  result: AuditResult;
  detail: Record<string, unknown> | null;
  actorUserId: string | null;
}

export interface AuditPage {
  entries: PublicAuditEntry[];
  next: string | null;
}

export interface AuditApi {
  listAiAudit(aiId: string, before?: string): Promise<AuditPage>;
}

export class AuditApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AuditApiError';
    this.status = status;
    this.code = code;
  }
}

const AuditResultSchema = Schema.Literals(['ok', 'denied', 'error']);

const AuditCostSchema = struct({
  currency: Schema.Literals(['EUR', 'USD']),
  amount: Schema.Number,
});

// The old `isRecord` guard accepted any non-null object as `detail`, arrays
// included; `Schema.declare` keeps that tolerance and the exported
// `Record<string, unknown>` type.
const LenientDetailSchema = Schema.declare(
  (value): value is Record<string, unknown> => typeof value === 'object' && value !== null,
);

const PublicAuditEntrySchema = struct({
  id: Schema.String,
  at: Schema.String,
  aiId: Schema.NullOr(Schema.String),
  groupId: Schema.NullOr(Schema.String),
  action: Schema.String,
  subjectId: Schema.NullOr(Schema.String),
  argsHash: Schema.NullOr(Schema.String),
  cost: Schema.NullOr(AuditCostSchema),
  result: AuditResultSchema,
  detail: Schema.NullOr(LenientDetailSchema),
  actorUserId: Schema.NullOr(Schema.String),
});

const AuditPageSchema = struct({
  entries: Schema.mutable(Schema.Array(PublicAuditEntrySchema)),
  next: Schema.NullOr(Schema.String),
});

function parseAuditPage(value: unknown): AuditPage | null {
  const decoded = Schema.decodeUnknownExit(AuditPageSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

// The internal failures, one per case. They carry no field beyond what the old
// `AuditApiError` already surfaced; the `Promise` edge maps each back to that
// same error, status, code and message.
class AuditNetworkError extends Data.TaggedError('AuditNetworkError') {}
class AuditRequestError extends Data.TaggedError('AuditRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class AuditUnauthorized extends Data.TaggedError('AuditUnauthorized') {}
class AuditInvalidResponse extends Data.TaggedError('AuditInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, AuditNetworkError | AuditRequestError> {
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetchImpl(`${apiUrl}${path}`, {
        ...init,
        signal,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          ...init.headers,
        },
      }),
    catch: () => new AuditNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new AuditRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** Page size, matching web `PAGE_LIMIT` in `AiActivity.tsx`. */
export const AUDIT_PAGE_LIMIT = 20;

/** The production `AuditApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createAuditApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): AuditApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    AuditUnauthorized | AuditNetworkError | AuditRequestError | AuditInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new AuditUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new AuditInvalidResponse();
    }
    return parsed;
  });

  const withToken = (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> =>
    Effect.runPromise(
      withTokenEffect(path, init, parse).pipe(
        Effect.catchTags({
          AuditUnauthorized: () =>
            Effect.fail(new AuditApiError(401, 'unauthorized', 'No session')),
          AuditNetworkError: () =>
            Effect.fail(new AuditApiError(0, 'network_error', 'Could not reach the server')),
          AuditRequestError: (error) =>
            Effect.fail(new AuditApiError(error.status, error.code, error.message)),
          AuditInvalidResponse: () =>
            Effect.fail(
              new AuditApiError(200, 'invalid_response', 'The server sent an unexpected response'),
            ),
        }),
      ),
    );

  return {
    async listAiAudit(aiId, before) {
      const params = new URLSearchParams();
      params.set('aiId', aiId);
      params.set('limit', String(AUDIT_PAGE_LIMIT));
      if (before !== undefined && before !== '') {
        params.set('before', before);
      }
      const body = await withToken(
        `/api/audit?${params.toString()}`,
        { method: 'GET' },
        parseAuditPage,
      );
      return body as AuditPage;
    },
  };
}
