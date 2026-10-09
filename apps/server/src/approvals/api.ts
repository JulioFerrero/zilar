// Approvals module on the Effect `HttpApi` adapter (T-0553): the same
// methods, paths, statuses (204 on delete), bodies, audit calls and step
// order as the deleted router (`routes.ts`), mounted by the Effect edge
// (`apps/server/src/effect/edge.ts`). Its service runs on effect/sql.

import { Effect, Layer, Schema } from 'effect';
import { HttpServer, HttpServerRequest, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from 'effect/http-api';
import { SqlClient, SqlError } from 'effect/sql';
import type { Logger } from 'pino';
import type { Auth } from '../auth/auth';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { approvalRules } from '../db/schema';
import { HttpError } from '../errors';
import type { EffectApiMount, EffectApiRoute } from '../effect/http-core';
import {
  CurrentUser,
  Session,
  failureResponse,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
} from '../effect/http-core';
import { sqlRuntimeFor } from '../effect/sql';
import { canSeeTopic, type TopicRow } from '../topics/access';
import {
  ApprovalServiceError,
  type AlwaysEligiblePredicate,
  approverNamesForTopics,
  decideApproval,
  getDecidableApproval,
  listDecidableApprovals,
  toPublicApproval,
} from './service';
import {
  isGroupAdmin,
  listActiveRulesForAi,
  listActiveRulesForTopic,
  revokeRule,
  toPublicRule,
  type PublicApprovalRule,
} from './rules';

// Reads run on the `effect/sql` client registered for this database (see
// `../effect/sql`); `transformResultNames` camelCases the columns so the rows
// keep the shapes the access helpers already take.
function runSql<A>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

// The minimum slice of pino the route needs to log a hook failure. The
// server wires its own logger; tests can pass a captor.
export interface ApprovalsRouteLogger {
  error: (fields: Record<string, unknown>, message: string) => void;
}

export interface ApprovalsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  /** Audit recorder; production wires the server's own recorder, real tests
   *  pass a recorder pointed at the test database. */
  audit?: AuditRecorder;
  now?: () => number;
  /** Logger used to render the error envelope and to record hook failures. */
  logger: Logger;
  /**
   * Optional hook fired after a successful decision. The action gateway
   * (T-0090) uses it to execute any pending action tied to the approval;
   * the response is returned to the user before the hook settles, and a
   * throwing hook never changes the decision response.
   */
  onDecided?: (approvalId: string) => Promise<void> | void;
  /**
   * T-0099: predicate the route uses to decide whether `approve_always`
   * is a real choice for this action. Absent = nothing is always
   * eligible, so `approve_always` is refused with 400
   * `always_not_allowed` and the public approval's `alwaysEligible`
   * flag is `false`.
   */
  alwaysEligible?: AlwaysEligiblePredicate;
}

// Replaces `decisionSchema` (zod): strict, `note` bounded like the protocol
// schema. The payload decode is strict (`PayloadParseOptions` below) so an
// excess key fails like the old `.strict()`.
const DecisionBody = Schema.Struct({
  decision: Schema.Literals(['approve_once', 'approve_always', 'deny']),
  note: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
});

const ApprovalStatus = Schema.Literals([
  'pending',
  'approved_once',
  'approved_always',
  'denied',
  'consumed',
  'expired',
]);

const WorstCase = Schema.Struct({
  currency: Schema.Literals(['EUR', 'USD']),
  amount: Schema.Number,
});

// Every field of `PublicApproval` (`service.ts`), compared side by side:
// id, aiId, groupId, topicId, topicName, action, summary, details,
// argsHash, worstCase, requestedBy, status, decidedAt, note, expiresAt,
// createdAt, alwaysEligible, approverNames.
const PublicApprovalView = Schema.Struct({
  id: Schema.String,
  aiId: Schema.String,
  groupId: Schema.NullOr(Schema.String),
  topicId: Schema.NullOr(Schema.String),
  topicName: Schema.NullOr(Schema.String),
  action: Schema.String,
  summary: Schema.String,
  details: Schema.NullOr(Schema.String),
  argsHash: Schema.String,
  worstCase: Schema.NullOr(WorstCase),
  requestedBy: Schema.String,
  status: ApprovalStatus,
  decidedAt: Schema.NullOr(Schema.Date),
  note: Schema.NullOr(Schema.String),
  expiresAt: Schema.Date,
  createdAt: Schema.Date,
  alwaysEligible: Schema.Boolean,
  approverNames: Schema.Array(Schema.String),
});

// Every field of `PublicApprovalRule` (`rules.ts`): id, action, scope,
// groupId, topicId, topicName, createdAt, createdBy.
const PublicApprovalRuleView = Schema.Struct({
  id: Schema.String,
  action: Schema.String,
  scope: Schema.Literals(['personal', 'group']),
  groupId: Schema.NullOr(Schema.String),
  topicId: Schema.NullOr(Schema.String),
  topicName: Schema.NullOr(Schema.String),
  createdAt: Schema.Date,
  createdBy: Schema.String,
});

const ApprovalIdParams = Schema.Struct({ id: Schema.String });

// Applied to the group so a payload decode failure renders like the old zod
// path: a 400 `invalid_request` carrying the fixed decision text (the old
// zod path answered the first issue's message; no test asserts the exact
// text, only the status).
class ApprovalsSchemaErrors extends HttpApiMiddleware.Service<ApprovalsSchemaErrors>()(
  'zilar/effect/http/ApprovalsSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<ApprovalsSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(ApprovalsSchemaErrors, () =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', 'Invalid decision body'),
      );
    }),
  );
}

const ApprovalsGroup = HttpApiGroup.make('approvals')
  .add(
    HttpApiEndpoint.get('list', '/approvals', {
      success: Schema.Array(PublicApprovalView),
    }),
    HttpApiEndpoint.get('detail', '/approvals/:id', {
      params: ApprovalIdParams,
      success: PublicApprovalView,
    }),
    HttpApiEndpoint.post('decide', '/approvals/:id/decision', {
      params: ApprovalIdParams,
      payload: DecisionBody,
      success: PublicApprovalView,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.get('aiRules', '/ais/:id/approval-rules', {
      params: ApprovalIdParams,
      success: Schema.Array(PublicApprovalRuleView),
    }),
    HttpApiEndpoint.get('groupRules', '/groups/:id/approval-rules', {
      params: ApprovalIdParams,
      success: Schema.Array(PublicApprovalRuleView),
    }),
    HttpApiEndpoint.delete('revokeRule', '/approval-rules/:id', {
      params: ApprovalIdParams,
      success: HttpApiSchema.NoContent,
    }),
  )
  .middleware(Session)
  .middleware(ApprovalsSchemaErrors)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

const ApprovalsApi = HttpApi.make('approvals').add(ApprovalsGroup);

export const APPROVALS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/approvals' },
  { method: 'GET', path: '/api/approvals/:id' },
  { method: 'POST', path: '/api/approvals/:id/decision' },
  { method: 'GET', path: '/api/ais/:id/approval-rules' },
  { method: 'GET', path: '/api/groups/:id/approval-rules' },
  { method: 'DELETE', path: '/api/approval-rules/:id' },
];

export function createApprovalsApi(deps: ApprovalsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const alwaysEligibleFn = deps.alwaysEligible ?? ((_action: string) => false);
  const onDecided = deps.onDecided;
  const hookLogger: ApprovalsRouteLogger | undefined =
    typeof (logger as ApprovalsRouteLogger).error === 'function'
      ? (logger as ApprovalsRouteLogger)
      : undefined;

  function fireOnDecided(approvalId: string): void {
    if (onDecided === undefined) {
      return;
    }
    // Fire-and-forget hook: the response is returned to the user before
    // the hook settles, and a throwing hook is logged rather than
    // surfaced. The action gateway uses this to execute a pending
    // action; a throw there must not turn a 200 into a 5xx for the user
    // who just approved the request.
    void Promise.resolve()
      .then(() => onDecided(approvalId))
      .catch((error: unknown) => {
        if (hookLogger !== undefined) {
          const name = error instanceof Error ? error.name : typeof error;
          logger.error({ err: name, approvalId }, 'onDecided hook threw');
        }
      });
  }

  const groupLayer = HttpApiBuilder.group(ApprovalsApi, 'approvals', (handlers) =>
    handlers
      .handle('list', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const approvals = yield* Effect.promise(() =>
              listDecidableApprovals(deps.db, user.id, new Date(now())),
            );
            const managedGroupIds = yield* Effect.promise(() =>
              managedGroupIdsForUser(deps.db, user.id),
            );
            const topicNames = yield* Effect.promise(() =>
              visibleTopicNames(deps.db, user.id, approvals),
            );
            return approvals.map((row) =>
              decoratePublic(
                {
                  ...row,
                  topicName: row.topicId === null ? null : (topicNames.get(row.topicId) ?? null),
                },
                alwaysEligibleFn,
                row.groupId === null || managedGroupIds.has(row.groupId),
              ),
            );
          }),
          logger,
          requestId,
        );
      })
      .handle('detail', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const approval = yield* Effect.promise(() =>
              getDecidableApproval(deps.db, request.params.id, user.id, new Date(now())),
            );
            if (!approval) {
              throw new HttpError(404, 'not_found', 'Approval not found');
            }
            const isManager =
              approval.groupId === null ||
              (yield* Effect.promise(() =>
                isGroupAdmin(deps.db, approval.groupId as string, user.id),
              ));
            return decoratePublic(
              {
                ...approval,
                topicName: yield* Effect.promise(() =>
                  visibleTopicName(deps.db, user.id, approval),
                ),
              },
              alwaysEligibleFn,
              isManager,
            );
          }),
          logger,
          requestId,
        );
      })
      .handle('decide', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const payload = request.payload;
            const result = yield* Effect.promise(() =>
              decideApproval(
                deps.db,
                {
                  approvalId: request.params.id,
                  userId: user.id,
                  decision: payload.decision,
                  ...(payload.note === undefined ? {} : { note: payload.note }),
                  alwaysEligible: alwaysEligibleFn,
                },
                new Date(now()),
              ),
            ).pipe(
              // `decideApproval` rejects with `ApprovalServiceError` for
              // validation and quota failures; the rejection surfaces as a
              // defect (`Effect.promise` never fails typed), so map it here
              // — a `try/catch` around `yield*` cannot see Effect failures.
              Effect.catchDefect((defect) => {
                if (defect instanceof ApprovalServiceError) {
                  const status =
                    defect.errorCode === 'expired' || defect.errorCode === 'not_pending'
                      ? 409
                      : defect.errorCode === 'always_requires_admin'
                        ? 403
                        : 400;
                  return Effect.die(new HttpError(status, defect.errorCode, defect.message));
                }
                return Effect.die(defect);
              }),
            );
            if (!result) {
              throw new HttpError(404, 'not_found', 'Approval not found');
            }
            const { row: updated, rule } = result;
            // A 409 (already decided / expired) is not logged; an ok decision
            // always is. `note` is intentionally dropped: the audit log must never
            // carry free text. `detail.decision` uses the wire enum so the log
            // matches what the request sent.
            if (deps.audit !== undefined) {
              yield* Effect.promise(() =>
                deps.audit!.record({
                  actorUserId: user.id,
                  aiId: updated.aiId,
                  groupId: updated.groupId,
                  action: 'approval.decided',
                  subjectId: updated.id,
                  argsHash: updated.argsHash,
                  costCurrency: null,
                  costAmount: null,
                  result: 'ok',
                  detail: { decision: payload.decision },
                }),
              );
              // T-0099: when `approve_always` succeeded, audit the rule creation
              // as a separate entry. Subject is the rule id, not the approval id,
              // so an audit reader can join the two. `detail.scope` makes the
              // personal-vs-group chat obvious without exposing the id.
              if (rule !== null) {
                yield* Effect.promise(() =>
                  deps.audit!.record({
                    actorUserId: user.id,
                    aiId: updated.aiId,
                    groupId: updated.groupId,
                    action: 'approval_rule.created',
                    subjectId: rule.id,
                    argsHash: null,
                    costCurrency: null,
                    costAmount: null,
                    result: 'ok',
                    detail: {
                      action: rule.action,
                      scope: rule.groupId === null ? 'personal' : 'group',
                    },
                  }),
                );
              }
            }
            fireOnDecided(updated.id);
            const topicName = yield* Effect.promise(() =>
              visibleTopicName(deps.db, user.id, { topicId: updated.topicId }),
            );
            const approverNames = yield* Effect.promise(() =>
              approverNamesForTopics(deps.db, [updated.topicId]),
            );
            return decoratePublic(
              toPublicApproval(
                updated,
                new Date(now()),
                false,
                topicName,
                approverNamesForRow(approverNames, updated.topicId),
              ),
              alwaysEligibleFn,
              updated.groupId === null ||
                (yield* Effect.promise(() =>
                  isGroupAdmin(deps.db, updated.groupId as string, user.id),
                )),
            );
          }),
          logger,
          requestId,
        );
      })
      // T-0099: rule management routes. All three require a session.
      // T-0110: rules are scoped to (AI, topic). The AI route returns rules of
      // topics the AI owner can see; the group route returns rules of topics
      // the viewer can see. Rows carry `topicId` and `topicName`.
      .handle('aiRules', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const aiId = request.params.id;
            const aiRow = yield* Effect.promise(() => loadAiOwnerRow(deps.db, aiId));
            // A stranger and a non-owner get the same 404 as a missing AI, so
            // existence is never leaked.
            if (aiRow === null || aiRow.owner !== user.id) {
              throw new HttpError(404, 'not_found', 'AI not found');
            }
            const rules = yield* Effect.promise(() => listActiveRulesForAi(deps.db, aiId));
            // Only rules of topics the owner can see: a rule in a private topic
            // the owner was removed from stays hidden until they are added back.
            const visible: PublicApprovalRule[] = [];
            for (const rule of rules) {
              if (rule.topicId === null) {
                visible.push({ ...rule, topicName: null });
                continue;
              }
              const topic = yield* Effect.promise(() =>
                loadTopicRow(deps.db, rule.topicId as string),
              );
              if (
                topic !== null &&
                (yield* Effect.promise(() => canSeeTopic(deps.db, topic, user.id)))
              ) {
                visible.push({ ...rule, topicName: topic.name });
              }
            }
            return visible;
          }),
          logger,
          requestId,
        );
      })
      .handle('groupRules', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const groupId = request.params.id;
            const allowed = yield* Effect.promise(() => isGroupAdmin(deps.db, groupId, user.id));
            if (!allowed) {
              throw new HttpError(404, 'not_found', 'Group not found');
            }
            const topicRows = yield* Effect.promise(() => loadTopicsForGroup(deps.db, groupId));
            const rules: PublicApprovalRule[] = [];
            for (const topic of topicRows) {
              if (topic.archivedAt !== null) {
                continue;
              }
              // A group admin who cannot see a private topic must not see its
              // rules either: only topics the viewer can see contribute rows.
              if (!(yield* Effect.promise(() => canSeeTopic(deps.db, topic, user.id)))) {
                continue;
              }
              const topicRules = yield* Effect.promise(() =>
                listActiveRulesForTopic(deps.db, topic.id),
              );
              for (const rule of topicRules) {
                rules.push({ ...toPublicRule(rule), topicName: topic.name });
              }
            }
            return rules;
          }),
          logger,
          requestId,
        );
      })
      .handle('revokeRule', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const ruleId = request.params.id;
            const existing = yield* Effect.promise(() => loadApprovalRule(deps.db, ruleId));
            // Same 404 shape for missing id and unauthorized: existence is never
            // leaked.
            if (existing === null) {
              throw new HttpError(404, 'not_found', 'Approval rule not found');
            }
            const allowed = yield* Effect.promise(() =>
              canManageRuleFor(deps.db, existing, user.id),
            );
            if (!allowed) {
              throw new HttpError(404, 'not_found', 'Approval rule not found');
            }
            const result = yield* Effect.promise(() =>
              revokeRule(deps.db, { ruleId, actorId: user.id, now: new Date(now()) }),
            );
            // `revokeRule` returns `null` only when the row vanished mid-call;
            // an already-revoked row returns its data and we answer 204.
            if (result === null) {
              throw new HttpError(404, 'not_found', 'Approval rule not found');
            }
            const { row: revokedRow } = result;
            if (deps.audit !== undefined) {
              yield* Effect.promise(() =>
                deps.audit!.record({
                  actorUserId: user.id,
                  aiId: revokedRow.aiId,
                  groupId: revokedRow.groupId,
                  action: 'approval_rule.revoked',
                  subjectId: revokedRow.id,
                  argsHash: null,
                  costCurrency: null,
                  costAmount: null,
                  result: 'ok',
                  detail: {
                    action: revokedRow.action,
                    scope: revokedRow.groupId === null ? 'personal' : 'group',
                  },
                }),
              );
            }
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(ApprovalsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // The edge keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: APPROVALS_API_ROUTES };
}

// One topic by id: the full row `canSeeTopic` needs (it reads visibility,
// group and archive state). `null` for a missing id, so callers keep the
// same visibility answers and 404s.
async function loadTopicRow(db: ServerDatabase, topicId: string): Promise<TopicRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE id = ${topicId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

// Every topic of one group, full rows for the same reason.
async function loadTopicsForGroup(
  db: ServerDatabase,
  groupId: string,
): Promise<ReadonlyArray<TopicRow>> {
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE group_id = ${groupId}`;
    }),
  );
}

// The AI ownership row: `id` distinguishes a missing AI from an unauthorized
// caller (both answer 404), `owner` is the ownership check.
interface AiOwnerRow {
  id: string;
  owner: string;
}

async function loadAiOwnerRow(db: ServerDatabase, aiId: string): Promise<AiOwnerRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiOwnerRow>`SELECT id, owner FROM ais WHERE id = ${aiId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

// One rule by id, full row so `canManageRuleFor` sees its topic/group/AI ids.
async function loadApprovalRule(
  db: ServerDatabase,
  ruleId: string,
): Promise<typeof approvalRules.$inferSelect | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<
        typeof approvalRules.$inferSelect
      >`SELECT * FROM approval_rules WHERE id = ${ruleId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

// Looks up the AI ownership directly and adds the group-admin check via
// the rules module. Kept in this file because it composes the two
// checks the route needs in one place. T-0110: both the AI owner and a
// group admin may revoke, but only for topics they can see.
async function canManageRuleFor(
  db: ServerDatabase,
  rule: typeof approvalRules.$inferSelect,
  userId: string,
): Promise<boolean> {
  if (rule.topicId !== null) {
    const topic = await loadTopicRow(db, rule.topicId);
    if (!topic || !(await canSeeTopic(db, topic, userId))) {
      return false;
    }
  }
  const aiRow = await loadAiOwnerRow(db, rule.aiId);
  if (aiRow && aiRow.owner === userId) {
    return true;
  }
  if (rule.groupId === null) {
    // Personal rule and the caller is not the AI owner: not allowed.
    return false;
  }
  return isGroupAdmin(db, rule.groupId, userId);
}

// Re-runs `toPublicApproval` with the always-eligible flag filled in.
// The service returns `alwaysEligible: false` because it does not own
// the registry; the route is the boundary that knows. T-0101: the flag
// is per viewer — a group approval is only always-eligible for a group
// owner/admin (`isManager`), since only they may create a group rule.
// Personal-chat approvals need no group check (`isManager` is `true`).
function decoratePublic(
  row: ReturnType<typeof toPublicApproval>,
  alwaysEligible: AlwaysEligiblePredicate,
  isManager: boolean,
): ReturnType<typeof toPublicApproval> {
  return { ...row, alwaysEligible: isManager && alwaysEligible(row.action) };
}

// The topic names for rows the viewer can see, keyed by topic id. A row
// whose topic the viewer cannot see gets no entry (callers map it to
// `topicName: null`); that cannot happen for a returned approval or rule,
// since visibility is already gated — the null is for the client shape.
async function visibleTopicNames(
  db: ServerDatabase,
  userId: string,
  rows: Array<{ topicId: string | null }>,
): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((row) => row.topicId).filter((id) => id !== null))];
  const names = new Map<string, string>();
  for (const id of ids) {
    const topic = await loadTopicRow(db, id);
    if (topic && (await canSeeTopic(db, topic, userId))) {
      names.set(id, topic.name);
    }
  }
  return names;
}

async function visibleTopicName(
  db: ServerDatabase,
  userId: string,
  row: { topicId: string | null },
): Promise<string | null> {
  if (row.topicId === null) {
    return null;
  }
  return (await visibleTopicNames(db, userId, [row])).get(row.topicId) ?? null;
}

// The approver names for one row from a batch map (empty when the row has
// no topic or the topic has no approver role).
function approverNamesForRow(names: Map<string, string[]>, topicId: string | null): string[] {
  return topicId === null ? [] : (names.get(topicId) ?? []);
}

// The group ids where the user is an owner/admin. One query for the
// whole list response — never one query per row.
async function managedGroupIdsForUser(db: ServerDatabase, userId: string): Promise<Set<string>> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ groupId: string }>`SELECT group_id FROM group_members
        WHERE user_id = ${userId} AND role IN ('owner', 'admin')`;
    }),
  );
  return new Set(rows.map((row) => row.groupId));
}
