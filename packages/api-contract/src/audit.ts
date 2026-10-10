// The audit read API (T-0079, T-0084): the audit rows of one group or one AI.
// A request names exactly one of `groupId` / `aiId`; the handler answers 400
// otherwise, because a query schema cannot express "one of two".

import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Session } from './middleware';
import { AuditSchemaErrors } from './middleware-chain-b';

export const MAX_AUDIT_LIST_LIMIT = 200;

// `limit` travels as a string and decodes to a positive integer within range;
// the query is strict, so an excess key is a 400.
export const ListAuditQuery = Schema.Struct({
  groupId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
  aiId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
  limit: Schema.optional(
    Schema.NumberFromString.check(
      Schema.isInt(),
      Schema.isBetween({ minimum: 1, maximum: MAX_AUDIT_LIST_LIMIT }),
    ),
  ),
  before: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
});

// Clients accept any object as `detail`, arrays included.
const AuditDetail = Schema.declare(
  (value): value is Record<string, unknown> => typeof value === 'object' && value !== null,
);

/** The public shape of one audit row. */
export const PublicAuditEntry = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  aiId: Schema.NullOr(Schema.String),
  groupId: Schema.NullOr(Schema.String),
  action: Schema.String,
  subjectId: Schema.NullOr(Schema.String),
  argsHash: Schema.NullOr(Schema.String),
  cost: Schema.NullOr(
    Schema.Struct({ currency: Schema.Literals(['EUR', 'USD']), amount: Schema.Number }),
  ),
  result: Schema.Literals(['ok', 'denied', 'error']),
  detail: Schema.NullOr(AuditDetail),
  actorUserId: Schema.NullOr(Schema.String),
});

export type PublicAuditEntry = typeof PublicAuditEntry.Type;

export const AuditPage = Schema.Struct({
  entries: Schema.Array(PublicAuditEntry),
  next: Schema.NullOr(Schema.String),
});

export type AuditPage = typeof AuditPage.Type;

export const AuditGroup = HttpApiGroup.make('audit')
  .add(
    HttpApiEndpoint.get('list', '/audit', {
      query: ListAuditQuery,
      success: AuditPage,
    }).annotate(HttpApi.QueryParseOptions, { onExcessProperty: 'error' }),
  )
  .middleware(Session)
  .middleware(AuditSchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
