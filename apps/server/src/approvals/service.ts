import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Effect, Result, Schema } from 'effect';
import { SqlClient, SqlError, type Statement } from 'effect/sql';
import { ARGS_HASH_PATTERN } from '@zilar/protocol';
import type { ServerDatabase } from '../db/client';
import { sqlRuntimeFor } from '../effect/sql';
import type { approvals } from '../db/schema';
import { canSeeTopic, getTopic } from '../topics/access';
import { createRuleEffect, isGroupAdmin } from './rules';

// Every query runs on the `effect/sql` client registered for this database
// (see `../effect/sql`). The exported functions stay `async` so routes and
// tests keep their shape during the transition.
function runSql<A, E>(
  db: ServerDatabase,
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

// `approved_always` is treated exactly like `approved_once` for the
// single-use path; T-0099 adds a separate standing-rule flow that the
// decision route triggers when the adapter is always-eligible and the
// decider chose `approve_always`.
export type ApprovalStatus =
  'pending' | 'approved_once' | 'approved_always' | 'denied' | 'consumed';

export type ApprovalDecision = 'approve_once' | 'approve_always' | 'deny';

export const MAX_PENDING_APPROVALS_PER_AI = 50;
export const MAX_APPROVAL_EXPIRY_MS = 24 * 60 * 60 * 1000;

const actionSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100));
const summarySchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500));
const detailsSchema = Schema.optional(Schema.String.check(Schema.isMaxLength(20000)));
const argsHashSchema = Schema.String.check(Schema.isPattern(ARGS_HASH_PATTERN));
const noteSchema = Schema.optional(Schema.String.check(Schema.isMaxLength(500)));
const requestedBySchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(3071));
const groupIdSchema = Schema.optional(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
);
const topicIdSchema = Schema.optional(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
);
const aiIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));

const worstCaseSchema = Schema.Struct({
  currency: Schema.Literals(['EUR', 'USD']),
  amount: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});

// The only validation text the callers ever see is the refine below; every
// other failure is mapped to `Invalid approval request` so no input value can
// reach an error message (Effect's default texts may quote the value).
const GROUP_TOPIC_REFINE_MESSAGE = 'groupId and topicId must be set together';
const INVALID_APPROVAL_REQUEST_MESSAGE = 'Invalid approval request';

export const CreateApprovalInputSchema = Schema.Struct({
  aiId: aiIdSchema,
  groupId: groupIdSchema,
  topicId: topicIdSchema,
  action: actionSchema,
  summary: summarySchema,
  details: detailsSchema,
  argsHash: argsHashSchema,
  worstCase: Schema.optional(worstCaseSchema),
  requestedBy: requestedBySchema,
  expiresAt: Schema.Date,
}).pipe(
  // T-0110: the scope is (AI, topic) — group and topic ids travel together.
  Schema.check(
    Schema.makeFilter((data) =>
      (data.groupId === undefined) === (data.topicId === undefined)
        ? undefined
        : GROUP_TOPIC_REFINE_MESSAGE,
    ),
  ),
);

export type CreateApprovalInput = typeof CreateApprovalInputSchema.Type;

// Strict decode (unknown keys rejected, like the old `z.strictObject`). The
// refine text is preserved; any other failure falls back to the fixed generic
// text, so a value is never echoed.
function parseCreateApprovalInput(input: unknown): CreateApprovalInput {
  const result = Schema.decodeUnknownResult(CreateApprovalInputSchema, {
    onExcessProperty: 'error',
  })(input);
  if (Result.isSuccess(result)) {
    return result.success;
  }
  const message = result.failure.message.includes(GROUP_TOPIC_REFINE_MESSAGE)
    ? GROUP_TOPIC_REFINE_MESSAGE
    : INVALID_APPROVAL_REQUEST_MESSAGE;
  throw new ApprovalServiceError('invalid_request', message);
}

// T-0099: the predicate the routes pass to `decideApproval` so the
// service can accept or refuse an `approve_always` decision. Absent =
// "nothing is always-eligible", so `approve_always` is refused with 400
// `always_not_allowed`.
export type AlwaysEligiblePredicate = (action: string) => boolean;

// T-0099: the result of an `approve_always` decision, returned by the
// service so the route can write the matching audit entries (one for
// `approval.decided` and one for `approval_rule.created`). The decision
// itself is still a normal approval — the rule sits next to it.
export interface CreatedApprovalRule {
  id: string;
  action: string;
  groupId: string | null;
  topicId: string | null;
  created: boolean;
}

export interface PublicApproval {
  id: string;
  aiId: string;
  groupId: string | null;
  /** The topic the request was raised in. Null for personal chats. */
  topicId: string | null;
  /** The topic's name, or null for personal chats. The route blanks this
   *  for topics the viewer cannot see (which cannot happen for a returned
   *  row); the field stays for the client. */
  topicName: string | null;
  action: string;
  summary: string;
  details: string | null;
  argsHash: string;
  worstCase: { currency: 'EUR' | 'USD'; amount: number } | null;
  requestedBy: string;
  status: ApprovalStatus | 'expired';
  decidedAt: Date | null;
  note: string | null;
  expiresAt: Date;
  createdAt: Date;
  // T-0099: `true` when the action is on the always-eligible list (the
  // adapter opted in via `allowAlways: true` and reports no cost). The
  // client uses this to decide whether to show the "Approve always"
  // button.
  alwaysEligible: boolean;
  // T-0134: the display names of the holders of the topic's approver role,
  // resolved server-side so the card does not call `getTopic` per approval
  // (N+1). Sorted by name, empty for personal chats and topics without an
  // approver role. Only topics the viewer can see ever reach the list, and
  // role membership is not secret, so no names leak.
  approverNames: string[];
}

export interface ApprovalVerifyResult {
  ok: boolean;
  decision?: ApprovalDecision;
}

// Thrown for validation and quota failures so routes can map them to 4xx with
// stable codes. Unknown or unauthorised ids return null instead, so routes
// answer 404.
export class ApprovalServiceError extends Error {
  readonly errorCode:
    | 'invalid_request'
    | 'expired'
    | 'not_pending'
    | 'pending_limit'
    | 'ai_not_in_group'
    | 'always_not_allowed'
    | 'always_requires_admin';

  constructor(errorCode: ApprovalServiceError['errorCode'], message: string) {
    super(message);
    this.name = 'ApprovalServiceError';
    this.errorCode = errorCode;
  }
}

type ApprovalRow = typeof approvals.$inferSelect;

// The raw shape the driver returns for one `approvals` row. The effect/sql
// client camelCases the columns but may hand back `timestamptz` as an ISO
// string rather than a `Date`; `toApprovalRow` normalises the three
// timestamp columns so the rest of the module keeps the drizzle row type.
type ApprovalSqlRow = Omit<ApprovalRow, 'decidedAt' | 'expiresAt' | 'createdAt'> & {
  decidedAt: Date | string | null;
  expiresAt: Date | string;
  createdAt: Date | string;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toApprovalRow(raw: ApprovalSqlRow): ApprovalRow {
  return {
    ...raw,
    decidedAt: raw.decidedAt === null ? null : toDate(raw.decidedAt),
    expiresAt: toDate(raw.expiresAt),
    createdAt: toDate(raw.createdAt),
  };
}

// Validates input at the boundary and writes one row. The AI must exist; if
// `groupId` is set, `topicId` must name a topic of that group (both set or
// both absent — personal chat). `expiresAt` must be in the future and at
// most 24 hours ahead. Per-AI pending cap is 50.
//
// The Effect version lets the action gateway yield it inside its
// `sql.withTransaction`, so the approval row and the `pending_actions` row
// commit together. The validation errors are typed `ApprovalServiceError`
// failures (not defects), so callers that catch around the Effect see the
// same error instance the old `throw` produced.
export function createApprovalEffect(
  input: CreateApprovalInput,
  now: Date,
): Effect.Effect<
  ApprovalRow,
  SqlError.SqlError | ApprovalServiceError | Error,
  SqlClient.SqlClient
> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const data = yield* Effect.try({
      try: () => parseCreateApprovalInput(input),
      catch: (error) =>
        error instanceof ApprovalServiceError
          ? error
          : new ApprovalServiceError('invalid_request', INVALID_APPROVAL_REQUEST_MESSAGE),
    });

    if (data.expiresAt.getTime() <= now.getTime()) {
      return yield* Effect.fail(
        new ApprovalServiceError('invalid_request', 'expires_at must be in the future'),
      );
    }
    if (data.expiresAt.getTime() - now.getTime() > MAX_APPROVAL_EXPIRY_MS) {
      return yield* Effect.fail(
        new ApprovalServiceError(
          'invalid_request',
          'expires_at must be at most 24 hours in the future',
        ),
      );
    }

    const [ai] = yield* sql<{ id: string }>`SELECT id FROM ais WHERE id = ${data.aiId} LIMIT 1`;
    if (!ai) {
      return yield* Effect.fail(new ApprovalServiceError('invalid_request', 'Unknown AI'));
    }

    if (data.groupId !== undefined) {
      const groupId = data.groupId;
      const [link] = yield* sql<{ aiId: string }>`SELECT ai_id FROM group_ais
        WHERE group_id = ${groupId} AND ai_id = ${data.aiId} LIMIT 1`;
      if (!link) {
        return yield* Effect.fail(
          new ApprovalServiceError('ai_not_in_group', 'The AI is not in that topic'),
        );
      }
      // The topic must belong to the group; the AI's membership of the topic
      // is checked by the gateway before this service is reached.
      const [topic] = yield* sql<{ id: string; groupId: string }>`SELECT id, group_id FROM topics
        WHERE id = ${data.topicId as string} LIMIT 1`;
      if (!topic || topic.groupId !== groupId) {
        return yield* Effect.fail(
          new ApprovalServiceError('ai_not_in_group', 'The AI is not in that topic'),
        );
      }
    }

    const [countRow] = yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM approvals
      WHERE ai_id = ${data.aiId} AND status = 'pending'`;
    if (Number(countRow?.total ?? 0) >= MAX_PENDING_APPROVALS_PER_AI) {
      return yield* Effect.fail(
        new ApprovalServiceError(
          'pending_limit',
          `At most ${MAX_PENDING_APPROVALS_PER_AI} pending approvals per AI`,
        ),
      );
    }

    const id = randomUUID();
    const row: typeof approvals.$inferInsert = {
      id,
      aiId: data.aiId,
      groupId: data.groupId ?? null,
      topicId: data.topicId ?? null,
      action: data.action,
      summary: data.summary,
      details: data.details ?? null,
      argsHash: data.argsHash,
      worstCaseCurrency: data.worstCase?.currency ?? null,
      worstCaseAmount: data.worstCase?.amount.toFixed(2) ?? null,
      requestedBy: data.requestedBy,
      status: 'pending',
      expiresAt: data.expiresAt,
    };
    const [created] = yield* sql<ApprovalSqlRow>`INSERT INTO approvals
        (id, ai_id, group_id, topic_id, action, summary, details, args_hash,
          worst_case_currency, worst_case_amount, requested_by, status, expires_at)
      VALUES (
        ${row.id},
        ${row.aiId},
        ${row.groupId},
        ${row.topicId},
        ${row.action},
        ${row.summary},
        ${row.details},
        ${row.argsHash},
        ${row.worstCaseCurrency},
        ${row.worstCaseAmount},
        ${row.requestedBy},
        ${row.status},
        ${row.expiresAt}
      )
      RETURNING *`;
    if (!created) {
      return yield* Effect.fail(new Error('Failed to create approval'));
    }
    return toApprovalRow(created);
  });
}

// Async wrapper kept for the routes, the sweeper and the tests during the
// transition (the action gateway yields `createApprovalEffect` directly).
export async function createApproval(
  db: ServerDatabase,
  input: CreateApprovalInput,
  now: Date,
): Promise<ApprovalRow> {
  return runSql(db, createApprovalEffect(input, now));
}

// Atomically decides a pending, unexpired request, but only if `userId` may
// decide it (AI owner, or group owner/admin when the request was raised in a
// group). A user who may not decide gets the same null as a missing id, so
// existence is never leaked. Two racing decisions: the conditional update
// makes exactly one win.
//
// T-0099: when `decision === 'approve_always'` and `alwaysEligible(action)`
// is `true`, an `approval_rules` row is created in the same transaction.
// The decision itself still proceeds: the request runs once (the existing
// `onDecided` path), and the rule applies to future matching requests.
export interface DecideApprovalResult {
  row: ApprovalRow;
  rule: CreatedApprovalRule | null;
}

export async function decideApproval(
  db: ServerDatabase,
  params: {
    approvalId: string;
    userId: string;
    decision: ApprovalDecision;
    note?: string;
    alwaysEligible?: AlwaysEligiblePredicate;
  },
  now: Date,
): Promise<DecideApprovalResult | null> {
  const noteResult = Schema.decodeUnknownResult(noteSchema)(params.note);
  if (Result.isFailure(noteResult)) {
    throw new ApprovalServiceError('invalid_request', 'Invalid note');
  }

  const [rawRow] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ApprovalSqlRow>`SELECT * FROM approvals
        WHERE id = ${params.approvalId} LIMIT 1`;
    }),
  );
  if (!rawRow) {
    return null;
  }
  const row = toApprovalRow(rawRow);
  // Authorisation comes first: a caller who may not decide must not learn
  // whether the request is expired or already decided.
  if (!(await canDecide(db, row, params.userId))) {
    return null;
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    throw new ApprovalServiceError('expired', 'Approval request has expired');
  }
  if (row.status !== 'pending') {
    throw new ApprovalServiceError('not_pending', 'Approval request has already been decided');
  }

  // T-0099: an "approve_always" decision that cannot create a rule (the
  // action is unknown, the adapter opted out, or the adapter reports a
  // cost) is refused before the row is updated so no state changes.
  // T-0101: for a group approval the decider must also be a group
  // owner/admin; a personal-chat approval needs no group check.
  if (params.decision === 'approve_always') {
    const eligible = params.alwaysEligible ?? (() => false);
    if (!eligible(row.action)) {
      throw new ApprovalServiceError(
        'always_not_allowed',
        `Action "${row.action}" cannot be always-allowed`,
      );
    }
    if (row.groupId !== null && !(await isGroupAdmin(db, row.groupId, params.userId))) {
      throw new ApprovalServiceError(
        'always_requires_admin',
        'Only a group admin can always allow an action in this group',
      );
    }
  }

  // The decision + (optional) rule creation share one transaction. If
  // either fails, both roll back. The decision is one conditional UPDATE; the
  // rule (on approve_always) is inserted on the same `effect/sql` client, so
  // `sql.withTransaction` wraps both.
  let createdRule: CreatedApprovalRule | null = null;
  const updated = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<ApprovalSqlRow>`UPDATE approvals
            SET status = ${decisionToStatus(params.decision)},
                decided_by = ${params.userId},
                decided_at = ${now},
                note = ${params.note ?? null}
            WHERE id = ${row.id} AND status = 'pending' AND expires_at > ${now}
            RETURNING *`;
          const decisionRow = rows[0];
          if (!decisionRow) {
            // A concurrent decision won, or the row expired between our
            // checks and the update. Signal "no row updated" so the caller
            // can re-read and pick the right error.
            return undefined;
          }

          if (params.decision === 'approve_always') {
            // The rule shares the decision's transaction: both commit or neither.
            const { rule, created } = yield* createRuleEffect(
              {
                aiId: row.aiId,
                groupId: row.groupId,
                topicId: row.topicId,
                action: row.action,
                createdBy: params.userId,
              },
              now,
            );
            createdRule = {
              id: rule.id,
              action: rule.action,
              groupId: rule.groupId,
              topicId: rule.topicId,
              created,
            };
          }

          return toApprovalRow(decisionRow);
        }),
      );
    }),
  );

  if (!updated) {
    // A concurrent decision won, or the row expired between our checks and the
    // update. Re-read to give the caller a stable error.
    const [rawFresh] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<ApprovalSqlRow>`SELECT * FROM approvals WHERE id = ${row.id} LIMIT 1`;
      }),
    );
    if (!rawFresh) {
      return null;
    }
    const fresh = toApprovalRow(rawFresh);
    if (fresh.expiresAt.getTime() <= now.getTime()) {
      throw new ApprovalServiceError('expired', 'Approval request has expired');
    }
    throw new ApprovalServiceError('not_pending', 'Approval request has already been decided');
  }
  return { row: updated, rule: createdRule };
}

// Verifies an approval for the engine. Returns `{ ok: true, decision }` only
// when the request is `approved_once` or `approved_always`, unexpired, and
// `argsHash` matches the stored hash (compared with `timingSafeEqual` so the
// answer cannot be used to recover the hash byte by byte). For both
// approvals the status is flipped to `consumed` with a conditional update so a second
// call fails. Any other state — wrong hash, not decided, denied, expired,
// already consumed — returns `{ ok: false }` with no detail.
//
// `approved_always` is treated like `approved_once` here on purpose: standing
// rules (always-allow for one action across requests) are a separate spec and
// the current behaviour is to make every approval consume.
export async function verifyApproval(
  db: ServerDatabase,
  params: { approvalId: string; argsHash: string },
  now: Date,
): Promise<ApprovalVerifyResult> {
  const [rawRow] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ApprovalSqlRow>`SELECT * FROM approvals
        WHERE id = ${params.approvalId} LIMIT 1`;
    }),
  );
  if (!rawRow) {
    return { ok: false };
  }
  const row = toApprovalRow(rawRow);
  if (row.status !== 'approved_once' && row.status !== 'approved_always') {
    return { ok: false };
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false };
  }
  if (!safeHashEquals(row.argsHash, params.argsHash)) {
    return { ok: false };
  }

  const [consumed] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`UPDATE approvals SET status = 'consumed'
        WHERE id = ${row.id} AND status = ${row.status} RETURNING id`;
    }),
  );
  if (!consumed) {
    return { ok: false };
  }
  return {
    ok: true,
    decision: row.status === 'approved_always' ? 'approve_always' : 'approve_once',
  };
}

// The approver-role holder names for a batch of topics, keyed by topic id.
// One batched query for the whole list response — never one query per row.
// Only holders who are still group members are named (a departed user is
// never listed even if their row survived the leave cleanup); topics
// without an approver role get no entry (callers map them to `[]`). One
// role may approve several topics: holder names fan out to every topic
// sharing the role.
export async function approverNamesForTopics(
  db: ServerDatabase,
  topicIds: Array<string | null>,
): Promise<Map<string, string[]>> {
  const unique = [...new Set(topicIds.filter((id): id is string => id !== null))];
  const names = new Map<string, string[]>();
  if (unique.length === 0) {
    return names;
  }
  const topicRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; approverRoleId: string | null }>`SELECT * FROM topics
        WHERE id IN ${sql.in(unique)}`;
    }),
  );
  const withRole = topicRows.filter((topic) => topic.approverRoleId !== null);
  if (withRole.length === 0) {
    return names;
  }
  const roleToTopics = new Map<string, string[]>();
  for (const topic of withRole) {
    const roleId = topic.approverRoleId as string;
    const list = roleToTopics.get(roleId) ?? [];
    list.push(topic.id);
    roleToTopics.set(roleId, list);
  }
  const holderRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ roleId: string; name: string; userId: string }>`SELECT
          gmr.role_id, u.name, u.id AS user_id
        FROM group_member_roles gmr
        INNER JOIN "user" u ON u.id = gmr.user_id
        INNER JOIN group_roles gr ON gr.id = gmr.role_id
        INNER JOIN group_members gm
          ON gm.group_id = gr.group_id AND gm.user_id = gmr.user_id
        WHERE gmr.role_id IN ${sql.in([...roleToTopics.keys()])}`;
    }),
  );
  const byTopic = new Map<string, Array<{ name: string; userId: string }>>();
  for (const row of holderRows) {
    const topicIds = roleToTopics.get(row.roleId) ?? [];
    for (const topicId of topicIds) {
      const list = byTopic.get(topicId) ?? [];
      list.push({ name: row.name, userId: row.userId });
      byTopic.set(topicId, list);
    }
  }
  for (const [topicId, holders] of byTopic) {
    holders.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
    names.set(
      topicId,
      holders.map((holder) => holder.name),
    );
  }
  return names;
}

// Lists the pending, unexpired approval requests `userId` may decide: their
// own AIs, plus groups they own or administer — in both cases only for
// topics they can see (a blind admin never counts a private topic's rows).
// Newest first, capped at 100.
export async function listDecidableApprovals(
  db: ServerDatabase,
  userId: string,
  now: Date,
): Promise<PublicApproval[]> {
  const allowedAiIds = await decidableAiIdsForUser(db, userId);
  const allowedGroupIds = await decidableGroupIdsForUser(db, userId);

  if (allowedAiIds.length === 0 && allowedGroupIds.length === 0) {
    return [];
  }

  const rawRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const conditions: Array<Statement.Fragment> = [];
      if (allowedAiIds.length > 0) {
        conditions.push(
          sql.and([
            sql`status = 'pending'`,
            sql`expires_at > ${now}`,
            sql`ai_id IN ${sql.in(allowedAiIds)}`,
          ]),
        );
      }
      if (allowedGroupIds.length > 0) {
        conditions.push(
          sql.and([
            sql`status = 'pending'`,
            sql`expires_at > ${now}`,
            sql`group_id IN ${sql.in(allowedGroupIds)}`,
          ]),
        );
      }
      return yield* sql<ApprovalSqlRow>`SELECT * FROM approvals
        WHERE ${sql.or(conditions)}
        ORDER BY created_at DESC LIMIT 100`;
    }),
  );
  const rows = rawRows.map(toApprovalRow);
  // A group admin who cannot see a private topic must not count its rows
  // in the pending badge: drop anything outside their visible topics.
  // Approver names ride the same batch so the card needs no extra read.
  const approverNames = await approverNamesForTopics(
    db,
    rows.map((row) => row.topicId),
  );
  const visible = [];
  for (const row of rows) {
    if (await canDecide(db, row, userId)) {
      visible.push(toPublicApproval(row, now, false, null, approverNamesFor(row, approverNames)));
    }
  }
  return visible;
}

function approverNamesFor(row: { topicId: string | null }, names: Map<string, string[]>): string[] {
  return row.topicId === null ? [] : (names.get(row.topicId) ?? []);
}

// One request by id, visible only to a user who may decide it. The read model
// maps a past-due `pending` row to `expired` without writing.
export async function getDecidableApproval(
  db: ServerDatabase,
  approvalId: string,
  userId: string,
  now: Date,
): Promise<PublicApproval | null> {
  const [rawRow] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ApprovalSqlRow>`SELECT * FROM approvals
        WHERE id = ${approvalId} LIMIT 1`;
    }),
  );
  if (!rawRow) {
    return null;
  }
  const row = toApprovalRow(rawRow);
  if (!(await canDecide(db, row, userId))) {
    return null;
  }
  const names = await approverNamesForTopics(db, [row.topicId]);
  return toPublicApproval(row, now, false, null, approverNamesFor(row, names));
}

// Used by the future sweeper (and the tests). Marks past-due `pending` rows
// `denied` with `note = 'expired'` so the read model and a hard `pending`
// query agree. Returns the swept rows' ids and AI/group ids so the sweeper
// can write one audit entry per row. The conditional `WHERE` keeps a
// concurrent decision from being overwritten.
export async function expireStale(
  db: ServerDatabase,
  now: Date,
): Promise<Array<{ id: string; aiId: string; groupId: string | null }>> {
  const updated = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; aiId: string; groupId: string | null }>`UPDATE approvals
          SET status = 'denied', decided_at = ${now}, note = 'expired'
        WHERE status = 'pending' AND expires_at < ${now}
        RETURNING id, ai_id, group_id`;
    }),
  );
  return updated.map((row) => ({ id: row.id, aiId: row.aiId, groupId: row.groupId }));
}

// Whether `userId` may decide `row`: the AI owner, or — when the request
// was raised in a topic — that group's owner or admin who can also see the
// topic. T-0116: or a holder of the topic's approver role who can see the
// topic. A group admin who cannot see a private topic gets the same false
// as a missing id, so existence is never leaked. The AI owner keeps
// deciding only while they can see the topic.
export async function canDecide(
  db: ServerDatabase,
  row: ApprovalRow,
  userId: string,
): Promise<boolean> {
  const [ai] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ owner: string }>`SELECT owner FROM ais WHERE id = ${row.aiId} LIMIT 1`;
    }),
  );
  if (!ai) {
    return false;
  }
  if (row.topicId !== null) {
    const topic = await getTopic(db, row.topicId);
    if (!topic || !(await canSeeTopic(db, topic, userId))) {
      return false;
    }
    // The approver role grants decide rights and nothing else: the holder
    // must see the topic (checked above), and the role never widens AI
    // management, rules or other topics. The join ties the role to the
    // approval's group, so the check is self-sufficient even if a stale
    // membership row ever survived a group leave. (`topicId` set implies
    // `groupId` set by the topic-scope CHECK; the guard below is for the
    // type checker.)
    const approverRoleId = topic.approverRoleId;
    if (approverRoleId !== null && row.groupId !== null) {
      const groupId = row.groupId;
      const [held] = await runSql(
        db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ userId: string }>`SELECT gmr.user_id FROM group_member_roles gmr
            INNER JOIN group_roles gr ON gr.id = gmr.role_id
            WHERE gmr.role_id = ${approverRoleId} AND gmr.user_id = ${userId}
              AND gr.group_id = ${groupId} LIMIT 1`;
        }),
      );
      if (held) {
        return true;
      }
    }
  }
  if (ai.owner === userId) {
    return true;
  }
  if (row.groupId === null) {
    return false;
  }
  const groupId = row.groupId;
  const [membership] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ role: string }>`SELECT role FROM group_members
        WHERE group_id = ${groupId} AND user_id = ${userId} LIMIT 1`;
    }),
  );
  return membership !== undefined && (membership.role === 'owner' || membership.role === 'admin');
}

async function decidableAiIdsForUser(db: ServerDatabase, userId: string): Promise<string[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`SELECT id FROM ais WHERE owner = ${userId}`;
    }),
  );
  return rows.map((row) => row.id);
}

async function decidableGroupIdsForUser(db: ServerDatabase, userId: string): Promise<string[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ groupId: string }>`SELECT group_id FROM group_members
        WHERE user_id = ${userId} AND role IN ('owner', 'admin')`;
    }),
  );
  return rows.map((row) => row.groupId);
}

// The read shape: a past-due `pending` row is mapped to `expired` without
// writing, and so is a row the sweeper already denied (`denied`, note
// `expired`, no human decider): the reader must not see "Denied" for a request
// nobody denied. `decided_by` is intentionally omitted.
//
// `alwaysEligible` is supplied by the caller because the service does not
// own the action registry — the gateway does. The route passes the
// predicate it built from the registry.
// `topicName` is supplied by the caller (the route) because the service
// does not gate visibility — the route passes the name only for topics the
// viewer can see, else null. Same for `approverNames`: the list/single
// readers above resolve them, and the decision route resolves them for the
// decided row.
export function toPublicApproval(
  row: ApprovalRow,
  now: Date,
  alwaysEligible: boolean = false,
  topicName: string | null = null,
  approverNames: string[] = [],
): PublicApproval {
  const isPending = row.status === 'pending';
  const sweptByTimer = row.status === 'denied' && row.note === 'expired' && row.decidedBy === null;
  const status: ApprovalStatus | 'expired' =
    sweptByTimer || (isPending && row.expiresAt.getTime() <= now.getTime())
      ? 'expired'
      : row.status;

  const hasWorstCase = row.worstCaseCurrency !== null && row.worstCaseAmount !== null;
  const worstCase = hasWorstCase
    ? {
        currency: row.worstCaseCurrency as 'EUR' | 'USD',
        amount: Number(row.worstCaseAmount),
      }
    : null;

  return {
    id: row.id,
    aiId: row.aiId,
    groupId: row.groupId,
    topicId: row.topicId,
    topicName,
    approverNames,
    action: row.action,
    summary: row.summary,
    details: row.details,
    argsHash: row.argsHash,
    worstCase,
    requestedBy: row.requestedBy,
    status,
    decidedAt: row.decidedAt,
    note: row.note,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    alwaysEligible,
  };
}

// Constant-time hash equality. Different lengths return false without ever
// touching `timingSafeEqual` (which would throw).
function safeHashEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  if (aBuf.length === 0 || aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

// The wire enum (`approve_once` / `approve_always` / `deny`) and the column
// enum (`approved_once` / `approved_always` / `denied`) are spelled apart on
// purpose, so the API stays in protocol shape while the row stays in storage
// shape.
function decisionToStatus(
  decision: ApprovalDecision,
): 'approved_once' | 'approved_always' | 'denied' {
  switch (decision) {
    case 'approve_once':
      return 'approved_once';
    case 'approve_always':
      return 'approved_always';
    case 'deny':
      return 'denied';
  }
}
