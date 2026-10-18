import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import {
  listAiApprovalRules,
  listGroupApprovalRules,
  revokeApprovalRule,
  type ApprovalRule,
  type GroupDetail,
} from '@/lib/api';
import { fromApi, type ApiFailure } from '@zilar/client-core';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { Button, FieldError } from '@/components/ais/AiPageShell';
import { StateMessage } from '@/components/ui/state-message';

export type AlwaysAllowedScope = { aiId: string } | { groupId: string };

function scopeKeyOf(scope: AlwaysAllowedScope, topicId?: string): string {
  const base = 'aiId' in scope ? `ai:${scope.aiId}` : `group:${scope.groupId}`;
  return topicId === undefined ? base : `${base}#${topicId}`;
}

function loadScopeRules(scope: AlwaysAllowedScope): Promise<ApprovalRule[]> {
  return 'aiId' in scope ? listAiApprovalRules(scope.aiId) : listGroupApprovalRules(scope.groupId);
}

export function scopeTextFor(
  rule: ApprovalRule,
  groupInfos: Record<string, GroupDetail>,
  topicName?: string | null,
): string {
  const name = topicName ?? rule.topicName ?? undefined;
  if (rule.scope === 'personal' || rule.groupId === null) {
    return name === undefined || name === '' ? 'Personal chat' : `Personal chat › ${name}`;
  }
  for (const info of Object.values(groupInfos)) {
    if (info.id === rule.groupId) {
      return name === undefined || name === '' ? `In ${info.title}` : `In ${info.title} › ${name}`;
    }
  }
  return name === undefined || name === '' ? 'In a group' : `In a group › ${name}`;
}

export function AlwaysAllowedList({
  scope,
  topicId,
  topicName,
  readOnly = false,
}: {
  scope: AlwaysAllowedScope;
  topicId?: string;
  topicName?: string;
  readOnly?: boolean;
}) {
  const groupInfos = useChatSelector((s) => s.groupInfos);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());

  const scopeKey = scopeKeyOf(scope, topicId);
  const [list, reload] = useQuery(() => fromApi(() => loadScopeRules(scope)), [scopeKey]);

  const dropRule = (id: string): void => {
    setConfirmingId((current) => (current === id ? null : current));
    setRemovedIds((ids) => new Set(ids).add(id));
  };
  const [revokeState, revoke, revokeControls] = useAction((rule: ApprovalRule) =>
    fromApi(() => revokeApprovalRule(rule.id)).pipe(
      Effect.tap(() => Effect.sync(() => dropRule(rule.id))),
      // A 404 means the rule is already gone (revoked elsewhere): drop the row quietly.
      Effect.catchTag('ApiFailure', (failure) =>
        failure.status === 404 ? Effect.sync(() => dropRule(rule.id)) : Effect.fail(failure),
      ),
      Effect.ensuring(
        Effect.sync(() => setRevokingId((current) => (current === rule.id ? null : current))),
      ),
    ),
  );

  const failure = listFailure(list);
  const status = AsyncResult.isSuccess(list)
    ? 'ready'
    : failure !== undefined
      ? 'error'
      : 'loading';
  const rules = AsyncResult.isSuccess(list)
    ? list.value.filter(
        (rule) => !removedIds.has(rule.id) && (topicId === undefined || rule.topicId === topicId),
      )
    : [];
  const revokeFailure = isWaiting(revokeState) ? undefined : failureOf(revokeState);

  const startRevoke = (rule: ApprovalRule): void => {
    setRevokingId(rule.id);
    revoke(rule);
  };

  return (
    <section
      aria-label="Always allowed"
      className="flex flex-col gap-2 border-t border-divider pt-4"
      data-scope={scopeKey}
    >
      <h3 className="text-[14px] font-medium">Always allowed</h3>

      {status === 'loading' && <StateMessage kind="loading" size="inline" title="Loading…" />}

      {status === 'error' && failure !== undefined && (
        <div className="flex flex-col gap-2">
          <FieldError>{loadMessage(failure)}</FieldError>
          <Button
            type="button"
            size="lg"
            className="self-start rounded-full px-5"
            onClick={() => reload()}
          >
            Retry
          </Button>
        </div>
      )}

      {status === 'ready' && rules.length === 0 && (
        <StateMessage kind="empty" size="inline" title="Nothing is always allowed here." />
      )}

      {status === 'ready' && rules.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Always allowed rules">
          {rules.map((rule) => {
            const confirming = confirmingId === rule.id;
            const revoking = revokingId === rule.id;
            return (
              <li
                key={rule.id}
                className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px]">{rule.action}</p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {scopeTextFor(rule, groupInfos, topicName)}
                  </p>
                </div>
                {readOnly ? null : confirming ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-[12px] text-muted-foreground">
                      Stop always allowing {rule.action}?
                    </span>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      aria-label={`Confirm revoking ${rule.action}`}
                      disabled={revoking}
                      onClick={() => startRevoke(rule)}
                    >
                      {revoking ? 'Revoking…' : 'Revoke'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={revoking}
                      onClick={() => {
                        setConfirmingId(null);
                        revokeControls.reset();
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Revoke ${rule.action}`}
                    className="shrink-0"
                    disabled={revokingId !== null}
                    onClick={() => {
                      setConfirmingId(rule.id);
                      revokeControls.reset();
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {revokeFailure !== undefined && <FieldError>{revokeMessage(revokeFailure)}</FieldError>}
    </section>
  );
}

function listFailure(
  list: AsyncResult.AsyncResult<ApprovalRule[], ApiFailure>,
): ApiFailure | undefined {
  return isWaiting(list) ? undefined : failureOf(list);
}

function loadMessage(failure: ApiFailure): string {
  return failure.code === 'unknown_error' ? 'Could not load the rules.' : failure.message;
}

function revokeMessage(failure: ApiFailure): string {
  return failure.code === 'unknown_error' ? 'Could not revoke the rule.' : failure.message;
}
