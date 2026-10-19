import { Effect, Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { SqlClient } from 'effect/sql';
import {
  ApprovalsGroup,
  ApprovalsSchemaErrors,
  type ApprovalRule,
  type PublicApproval,
} from '@zilar/api-contract';
import type { ServerCore } from '../app/deps';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { EffectApiMount } from '../effect/http-core';
import { handler, mountApi, schemaErrorLayerFor, sessionLayer } from '../effect/http-core';
import { canSeeTopic, getTopic, type TopicRow } from '../topics/access';
import { decideApproval } from './service';
import {
  listActiveRulesForAi,
  listActiveRulesForTopic,
  revokeRule,
  toPublicRule,
  type PublicApprovalRule,
} from './rules';
import { isGroupManager } from '../groups/access';
import { type ApprovalRuleRow } from '../db/rows-agents';
import { ApprovalServiceError, type AlwaysEligiblePredicate } from './schemas';
import {
  approverNamesForTopics,
  getDecidableApproval,
  listDecidableApprovals,
  toPublicApproval,
} from './queries';

// The minimum slice of pino the route needs; tests can pass a captor.
export interface ApprovalsRouteLogger {
  error: (fields: Record<string, unknown>, message: string) => void;
}

export interface ApprovalsApiDependencies extends Pick<ServerCore, 'auth' | 'db' | 'logger'> {
  audit?: AuditRecorder;
  now?: () => number;
  /** Fired after a successful decision; the response returns first and a
   *  throwing hook never changes it. */
  onDecided?: (approvalId: string) => Promise<void> | void;
  /** Absent means nothing is always eligible, so `approve_always` is refused. */
  alwaysEligible?: AlwaysEligiblePredicate;
}

// Supplied by `approvalNames` (one query per table, not one per row).
export type WireApprovalInput = ReturnType<typeof toPublicApproval> & {
  aiName: string;
  groupName: string | null;
};

export function toWireApproval(row: WireApprovalInput): PublicApproval {
  return {
    ...row,
    decidedAt: row.decidedAt === null ? null : row.decidedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toWireRule(rule: PublicApprovalRule): ApprovalRule {
  return { ...rule, createdAt: rule.createdAt.toISOString() };
}

export async function loadTopicsForGroup(
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

// `id` distinguishes a missing AI from an unauthorized caller (both answer 404).
export interface AiOwnerRow {
  id: string;
  owner: string;
}

export async function loadAiOwnerRow(db: ServerDatabase, aiId: string): Promise<AiOwnerRow | null> {
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
export async function loadApprovalRule(
  db: ServerDatabase,
  ruleId: string,
): Promise<ApprovalRuleRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ApprovalRuleRow>`SELECT * FROM approval_rules WHERE id = ${ruleId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

// Both the AI owner and a group admin may revoke, but only for topics they can
// see.
export async function canManageRuleFor(
  db: ServerDatabase,
  rule: ApprovalRuleRow,
  userId: string,
): Promise<boolean> {
  if (rule.topicId !== null) {
    const topic = await getTopic(db, rule.topicId);
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
  return isGroupManager(db, rule.groupId, userId);
}

// The route owns the action registry and knows the viewer's group role, so it
// fills the always-eligible flag the service cannot know.
export function decoratePublic(
  row: ReturnType<typeof toPublicApproval>,
  alwaysEligible: AlwaysEligiblePredicate,
  isManager: boolean,
  names: { aiName: string; groupName: string | null } = { aiName: '', groupName: null },
): PublicApproval {
  return toWireApproval({
    ...row,
    ...names,
    alwaysEligible: isManager && alwaysEligible(row.action),
  });
}

// One query for the AIs and one for the groups, never one per row; an id that
// no longer exists gets no entry.
export interface ApprovalNames {
  aiNames: Map<string, string>;
  groupNames: Map<string, string>;
}

export async function approvalNames(
  db: ServerDatabase,
  rows: ReadonlyArray<{ aiId: string; groupId: string | null }>,
): Promise<ApprovalNames> {
  const aiIds = [...new Set(rows.map((row) => row.aiId))];
  const groupIds = [
    ...new Set(rows.map((row) => row.groupId).filter((id): id is string => id !== null)),
  ];
  const aiNames = new Map<string, string>();
  if (aiIds.length > 0) {
    const aiRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ id: string; name: string }>`SELECT id, name FROM ais
          WHERE id IN ${sql.in(aiIds)}`;
      }),
    );
    for (const row of aiRows) {
      aiNames.set(row.id, row.name);
    }
  }
  const groupNames = new Map<string, string>();
  if (groupIds.length > 0) {
    const groupRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ id: string; title: string }>`SELECT id, title FROM groups
          WHERE id IN ${sql.in(groupIds)}`;
      }),
    );
    for (const row of groupRows) {
      groupNames.set(row.id, row.title);
    }
  }
  return { aiNames, groupNames };
}

// A missing AI is `''`; no group (or a deleted group) is `null`.
export function namesForApproval(
  names: ApprovalNames,
  row: { aiId: string; groupId: string | null },
): { aiName: string; groupName: string | null } {
  return {
    aiName: names.aiNames.get(row.aiId) ?? '',
    groupName: row.groupId === null ? null : (names.groupNames.get(row.groupId) ?? null),
  };
}

// Only topics the viewer can see get a name; an invisible one maps to null,
// which a returned row should never hit since visibility is already gated.
export async function visibleTopicNames(
  db: ServerDatabase,
  userId: string,
  rows: Array<{ topicId: string | null }>,
): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((row) => row.topicId).filter((id) => id !== null))];
  const names = new Map<string, string>();
  for (const id of ids) {
    const topic = await getTopic(db, id);
    if (topic && (await canSeeTopic(db, topic, userId))) {
      names.set(id, topic.name);
    }
  }
  return names;
}

export async function visibleTopicName(
  db: ServerDatabase,
  userId: string,
  row: { topicId: string | null },
): Promise<string | null> {
  if (row.topicId === null) {
    return null;
  }
  return (await visibleTopicNames(db, userId, [row])).get(row.topicId) ?? null;
}

export function approverNamesForRow(
  names: Map<string, string[]>,
  topicId: string | null,
): string[] {
  return topicId === null ? [] : (names.get(topicId) ?? []);
}

// One query for the whole list response, never one per row.
export async function managedGroupIdsForUser(
  db: ServerDatabase,
  userId: string,
): Promise<Set<string>> {
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

const ApprovalsApi = HttpApi.make('approvals').add(ApprovalsGroup);

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
    // Fire-and-forget: the response returns first, and a throwing hook is logged
    // rather than surfacing as a 5xx for the user who just approved.
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
      .handle(
        'list',
        handler(logger, (_request, user) =>
          Effect.gen(function* () {
            const approvals = yield* Effect.promise(() =>
              listDecidableApprovals(deps.db, user.id, new Date(now())),
            );
            const managedGroupIds = yield* Effect.promise(() =>
              managedGroupIdsForUser(deps.db, user.id),
            );
            const topicNames = yield* Effect.promise(() =>
              visibleTopicNames(deps.db, user.id, approvals),
            );
            const names = yield* Effect.promise(() => approvalNames(deps.db, approvals));
            return approvals.map((row) =>
              decoratePublic(
                {
                  ...row,
                  topicName: row.topicId === null ? null : (topicNames.get(row.topicId) ?? null),
                },
                alwaysEligibleFn,
                row.groupId === null || managedGroupIds.has(row.groupId),
                namesForApproval(names, row),
              ),
            );
          }),
        ),
      )
      .handle(
        'detail',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const approval = yield* Effect.promise(() =>
              getDecidableApproval(deps.db, request.params.id, user.id, new Date(now())),
            );
            if (!approval) {
              throw new HttpError(404, 'not_found', 'Approval not found');
            }
            const isManager =
              approval.groupId === null ||
              (yield* Effect.promise(() =>
                isGroupManager(deps.db, approval.groupId as string, user.id),
              ));
            const names = yield* Effect.promise(() => approvalNames(deps.db, [approval]));
            return decoratePublic(
              {
                ...approval,
                topicName: yield* Effect.promise(() =>
                  visibleTopicName(deps.db, user.id, approval),
                ),
              },
              alwaysEligibleFn,
              isManager,
              namesForApproval(names, approval),
            );
          }),
        ),
      )
      .handle(
        'decide',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
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
              // `Effect.promise` surfaces the rejection as a defect, so map
              // `ApprovalServiceError` here.
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
            // The audit log never carries free text, so `note` is dropped.
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
              // An `approve_always` rule gets its own entry, with the rule id as
              // subject so an audit reader can join the two.
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
            const names = yield* Effect.promise(() => approvalNames(deps.db, [updated]));
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
                  isGroupManager(deps.db, updated.groupId as string, user.id),
                )),
              namesForApproval(names, updated),
            );
          }),
        ),
      )
      // Rules are scoped to (AI, topic), and a route only returns topics its
      // viewer can see.
      .handle(
        'aiRules',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const aiId = request.params.id;
            const aiRow = yield* Effect.promise(() => loadAiOwnerRow(deps.db, aiId));
            // A stranger and a non-owner get the same 404 as a missing AI.
            if (aiRow === null || aiRow.owner !== user.id) {
              throw new HttpError(404, 'not_found', 'AI not found');
            }
            const rules = yield* Effect.promise(() => listActiveRulesForAi(deps.db, aiId));
            // A rule in a private topic the owner was removed from stays hidden.
            const visible: PublicApprovalRule[] = [];
            for (const rule of rules) {
              if (rule.topicId === null) {
                visible.push({ ...rule, topicName: null });
                continue;
              }
              const topic = yield* Effect.promise(() => getTopic(deps.db, rule.topicId as string));
              if (
                topic !== null &&
                (yield* Effect.promise(() => canSeeTopic(deps.db, topic, user.id)))
              ) {
                visible.push({ ...rule, topicName: topic.name });
              }
            }
            return visible.map(toWireRule);
          }),
        ),
      )
      .handle(
        'groupRules',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const groupId = request.params.id;
            const allowed = yield* Effect.promise(() => isGroupManager(deps.db, groupId, user.id));
            if (!allowed) {
              throw new HttpError(404, 'not_found', 'Group not found');
            }
            const topicRows = yield* Effect.promise(() => loadTopicsForGroup(deps.db, groupId));
            const rules: PublicApprovalRule[] = [];
            for (const topic of topicRows) {
              if (topic.archivedAt !== null) {
                continue;
              }
              // A group admin who cannot see a private topic must not see its rules.
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
            return rules.map(toWireRule);
          }),
        ),
      )
      .handle(
        'revokeRule',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const ruleId = request.params.id;
            const existing = yield* Effect.promise(() => loadApprovalRule(deps.db, ruleId));
            // Missing and unauthorized answer the same 404.
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
            // `null` only when the row vanished mid-call; an already-revoked row
            // answers 204.
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
        ),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(ApprovalsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    // A payload decode failure carries the fixed decision text.
    Layer.provide(schemaErrorLayerFor(ApprovalsSchemaErrors, logger, 'Invalid decision body')),
  );

  return mountApi(ApprovalsApi, apiLayer);
}
