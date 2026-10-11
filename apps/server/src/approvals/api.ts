// Approvals module on the Effect `HttpApi` adapter (T-0553): the same
// methods, paths, statuses (204 on delete), bodies, audit calls and step
// order as the deleted router (`routes.ts`), mounted by the Effect edge
// (`apps/server/src/effect/edge.ts`). Its service runs on effect/sql.

import { Effect, Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { ApprovalsGroup, ApprovalsSchemaErrors } from '@zilar/api-contract';
import { HttpError } from '../errors';
import type { EffectApiMount } from '../effect/http-core';
import { handler, mountApi, schemaErrorLayerFor, sessionLayer } from '../effect/http-core';
import { canSeeTopic } from '../topics/access';
import {
  type ApprovalsApiDependencies,
  type ApprovalsRouteLogger,
  approverNamesForRow,
  canManageRuleFor,
  decoratePublic,
  loadAiOwnerRow,
  loadApprovalRule,
  loadTopicRow,
  loadTopicsForGroup,
  managedGroupIdsForUser,
  toWireRule,
  visibleTopicName,
  visibleTopicNames,
} from './api-reads';
import {
  ApprovalServiceError,
  approverNamesForTopics,
  decideApproval,
  getDecidableApproval,
  listDecidableApprovals,
  toPublicApproval,
} from './service';
import {
  listActiveRulesForAi,
  listActiveRulesForTopic,
  revokeRule,
  toPublicRule,
  type PublicApprovalRule,
} from './rules';
import { isGroupManager } from '../groups/access';

export type { ApprovalsRouteLogger, ApprovalsApiDependencies } from './api-reads';

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
                  isGroupManager(deps.db, updated.groupId as string, user.id),
                )),
            );
          }),
        ),
      )
      // T-0099: rule management routes. All three require a session.
      // T-0110: rules are scoped to (AI, topic). The AI route returns rules of
      // topics the AI owner can see; the group route returns rules of topics
      // the viewer can see. Rows carry `topicId` and `topicName`.
      .handle(
        'aiRules',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
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
