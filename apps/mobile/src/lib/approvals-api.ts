import { Data, Effect, Exit, Schema, SchemaGetter, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { errorFieldsOf } from './api-error-body';
import { API_URL } from './auth';

/**
 * The approvals API (`/api/approvals`), the mobile twin of the web client in
 * `apps/web/src/lib/api.ts`. The wire contract lives in
 * `apps/server/src/approvals/routes.ts` and `apps/server/src/approvals/service.ts`.
 *
 * The boundary is validated with Effect Schema (T-0541, the T-0506 recipe):
 * the request is an Effect pipeline, cut back to a `Promise` at the edge
 * with `Effect.runPromise`. `ApprovalsApiError` keeps the server's `code`
 * and `status`, so the card can branch on the error without parsing the
 * message again (404 = not decidable, 409 = race / expired).
 */

export type ApprovalStatus =
  'pending' | 'approved_once' | 'approved_always' | 'denied' | 'consumed' | 'expired';

export type ApprovalDecision = 'approve_once' | 'approve_always' | 'deny';

export interface ApprovalWorstCase {
  currency: 'EUR' | 'USD';
  amount: number;
}

export interface PublicApproval {
  id: string;
  aiId: string;
  groupId: string | null;
  action: string;
  summary: string;
  details: string | null;
  argsHash: string;
  worstCase: ApprovalWorstCase | null;
  requestedBy: string;
  status: ApprovalStatus;
  decidedAt: string | null;
  note: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface ApprovalsApi {
  getApproval(id: string): Promise<PublicApproval>;
  decideApproval(id: string, decision: ApprovalDecision, note?: string): Promise<PublicApproval>;
  listApprovals(): Promise<PublicApproval[]>;
  listAiApprovalRules(aiId: string): Promise<ApprovalRule[]>;
  listGroupApprovalRules(groupId: string): Promise<ApprovalRule[]>;
  revokeApprovalRule(id: string): Promise<void>;
}

export type ApprovalRuleScope = 'personal' | 'group';

export interface ApprovalRule {
  id: string;
  action: string;
  scope: ApprovalRuleScope;
  groupId: string | null;
  topicId: string | null;
  topicName: string | null;
  createdAt: string;
  createdBy: string;
}

export class ApprovalsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApprovalsApiError';
    this.status = status;
    this.code = code;
  }
}

// A lenient field: a missing or non-string value decodes to `null` instead of
// failing the row, exactly like the old type guard. The key may be absent
// (older servers omit it).
const LenientNullableStringSchema = Schema.Unknown.pipe(
  Schema.withDecodingDefault(Effect.succeed(null)),
  Schema.decodeTo(Schema.NullOr(Schema.String), {
    decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : null)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

const ApprovalStatusSchema = Schema.Literals([
  'pending',
  'approved_once',
  'approved_always',
  'denied',
  'consumed',
  'expired',
]);

const ApprovalWorstCaseSchema = struct({
  currency: Schema.Literals(['EUR', 'USD']),
  amount: Schema.Number,
});

const PublicApprovalSchema = struct({
  id: Schema.String,
  aiId: Schema.String,
  groupId: LenientNullableStringSchema,
  action: Schema.String,
  summary: Schema.String,
  details: LenientNullableStringSchema,
  argsHash: Schema.String,
  worstCase: Schema.NullOr(ApprovalWorstCaseSchema),
  requestedBy: Schema.String,
  status: ApprovalStatusSchema,
  decidedAt: LenientNullableStringSchema,
  note: LenientNullableStringSchema,
  expiresAt: Schema.String,
  createdAt: Schema.String,
});

const ApprovalRuleSchema = struct({
  id: Schema.String,
  action: Schema.String,
  scope: Schema.Literals(['personal', 'group']),
  groupId: LenientNullableStringSchema,
  // Optional on the wire (older servers omit them); a non-string value
  // reads like absence rather than failing the whole list.
  topicId: LenientNullableStringSchema,
  topicName: LenientNullableStringSchema,
  createdAt: Schema.String,
  createdBy: Schema.String,
});

// The list endpoints answer with a bare array; one malformed row fails the
// whole list, like the old `parseList`.
const ApprovalListEnvelopeSchema = Schema.mutable(Schema.Array(Schema.Unknown));

function parsePublicApproval(value: unknown): PublicApproval | null {
  const decoded = Schema.decodeUnknownExit(PublicApprovalSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseApprovalRule(value: unknown): ApprovalRule | null {
  const decoded = Schema.decodeUnknownExit(ApprovalRuleSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseApprovalList(value: unknown): PublicApproval[] | null {
  const decoded = Schema.decodeUnknownExit(ApprovalListEnvelopeSchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  const parsed: PublicApproval[] = [];
  for (const item of decoded.value) {
    const approval = parsePublicApproval(item);
    if (approval === null) return null;
    parsed.push(approval);
  }
  return parsed;
}

function parseApprovalRuleList(value: unknown): ApprovalRule[] | null {
  const decoded = Schema.decodeUnknownExit(ApprovalListEnvelopeSchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  const parsed: ApprovalRule[] = [];
  for (const item of decoded.value) {
    const rule = parseApprovalRule(item);
    if (rule === null) return null;
    parsed.push(rule);
  }
  return parsed;
}

/** The exact POST body the server's strict `decisionSchema` accepts. */
export function buildDecisionBody(
  decision: ApprovalDecision,
  note?: string,
): Record<string, unknown> {
  return note === undefined ? { decision } : { decision, note };
}

// The internal failures, one per case. They carry no field beyond what the
// old `ApprovalsApiError` already surfaced; the `Promise` edge maps each back
// to that same error, status, code and message.
class ApprovalsNetworkError extends Data.TaggedError('ApprovalsNetworkError') {}
class ApprovalsRequestError extends Data.TaggedError('ApprovalsRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class ApprovalsUnauthorized extends Data.TaggedError('ApprovalsUnauthorized') {}
class ApprovalsInvalidResponse extends Data.TaggedError('ApprovalsInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, ApprovalsNetworkError | ApprovalsRequestError> {
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
    catch: () => new ApprovalsNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new ApprovalsRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The production `ApprovalsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createApprovalsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ApprovalsApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    ApprovalsUnauthorized | ApprovalsNetworkError | ApprovalsRequestError | ApprovalsInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new ApprovalsUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new ApprovalsInvalidResponse();
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
          ApprovalsUnauthorized: () =>
            Effect.fail(new ApprovalsApiError(401, 'unauthorized', 'No session')),
          ApprovalsNetworkError: () =>
            Effect.fail(new ApprovalsApiError(0, 'network_error', 'Could not reach the server')),
          ApprovalsRequestError: (error) =>
            Effect.fail(new ApprovalsApiError(error.status, error.code, error.message)),
          ApprovalsInvalidResponse: () =>
            Effect.fail(
              new ApprovalsApiError(
                200,
                'invalid_response',
                'The server sent an unexpected response',
              ),
            ),
        }),
      ),
    );

  return {
    async getApproval(id) {
      const body = await withToken(
        `/api/approvals/${encodeURIComponent(id)}`,
        { method: 'GET' },
        parsePublicApproval,
      );
      return body as PublicApproval;
    },
    async decideApproval(id, decision, note) {
      const body = buildDecisionBody(decision, note);
      const result = await withToken(
        `/api/approvals/${encodeURIComponent(id)}/decision`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        parsePublicApproval,
      );
      return result as PublicApproval;
    },
    async listApprovals() {
      const body = await withToken('/api/approvals', { method: 'GET' }, parseApprovalList);
      return body as PublicApproval[];
    },
    async listAiApprovalRules(aiId) {
      const body = await withToken(
        `/api/ais/${encodeURIComponent(aiId)}/approval-rules`,
        { method: 'GET' },
        parseApprovalRuleList,
      );
      return body as ApprovalRule[];
    },
    async listGroupApprovalRules(groupId) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/approval-rules`,
        { method: 'GET' },
        parseApprovalRuleList,
      );
      return body as ApprovalRule[];
    },
    async revokeApprovalRule(id) {
      await withToken(
        `/api/approval-rules/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        // A 204 has no body (`request` yields null): any 2xx means revoked.
        () => true,
      );
    },
  };
}
