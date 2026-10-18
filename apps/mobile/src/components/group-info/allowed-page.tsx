import { ApiError } from '@zilar/api-contract';
import { Effect } from 'effect';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlwaysAllowedRow, RevokeConfirmDialog } from '@/components/approvals/always-allowed-row';
import { useApprovalsApi } from '@/components/chat/use-approvals-api';
import { Button } from '@/components/ui/button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import type { ApprovalRule } from '@/lib/approvals-api';
import { interruptFiber } from '@zilar/client-core';
import { isWaiting, useAction } from '@/lib/effect/use-action';

export const RULES_LOAD_FAILED_MESSAGE = 'Could not load the rules.';

export const REVOKE_FAILED_MESSAGE = 'Could not revoke the rule. Try again.';

export type RulesStatus = 'loading' | 'ready' | 'error';

/**
 * The group's always-allowed rules: the list, its load state and the revoke
 * flow. The route calls it once so the root's count and the page read the same
 * list (one request instead of two).
 */
export interface GroupRulesHandle {
  status: RulesStatus;
  rules: ApprovalRule[];
  error: string;
  retry: () => void;
  revoking: boolean;
  revokeError: string;
  confirmRule: ApprovalRule | null;
  requestRevoke: (rule: ApprovalRule) => void;
  cancelRevoke: () => void;
  confirmRevoke: () => void;
}

/** A 404 on revoke means the rule is already gone; the row drops quietly. */
const isAlreadyGone = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 404;

export function useGroupRules(groupId: string, enabled = true): GroupRulesHandle {
  const { api } = useApprovalsApi();
  const [status, setStatus] = useState<RulesStatus>('loading');
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [confirmRule, setConfirmRule] = useState<ApprovalRule | null>(null);
  const [revokeError, setRevokeError] = useState('');
  const [revokeState, runRevoke] = useAction((id: string) =>
    Effect.tryPromise({ try: () => api.revokeApprovalRule(id), catch: (cause) => cause }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          setRules((current) => current.filter((rule) => rule.id !== id));
          setConfirmRule(null);
        }),
      ),
      Effect.catch((cause: unknown) =>
        Effect.sync(() => {
          if (isAlreadyGone(cause)) {
            setRules((current) => current.filter((rule) => rule.id !== id));
            setConfirmRule(null);
          } else {
            setRevokeError(REVOKE_FAILED_MESSAGE);
          }
        }),
      ),
    ),
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    // Unmount or a new group interrupts the load, so a late answer never lands.
    const load = Effect.tryPromise({
      try: () => api.listGroupApprovalRules(groupId),
      catch: (cause) => cause,
    }).pipe(
      Effect.matchEffect({
        onFailure: () =>
          Effect.sync(() => {
            setStatus('error');
            setRules([]);
            setError(RULES_LOAD_FAILED_MESSAGE);
          }),
        onSuccess: (list) =>
          Effect.sync(() => {
            setRules(list);
            setStatus('ready');
            setError('');
          }),
      }),
    );
    const fiber = Effect.runFork(load);
    return () => {
      interruptFiber(fiber);
    };
  }, [api, groupId, enabled, reloadTick]);

  const retry = () => {
    setStatus('loading');
    setError('');
    setReloadTick((tick) => tick + 1);
  };

  const requestRevoke = (rule: ApprovalRule) => {
    setRevokeError('');
    setConfirmRule(rule);
  };

  const confirmRevoke = () => {
    if (confirmRule === null || isWaiting(revokeState)) {
      return;
    }
    setRevokeError('');
    runRevoke(confirmRule.id);
  };

  return {
    status,
    rules,
    error,
    retry,
    revoking: isWaiting(revokeState),
    revokeError,
    confirmRule,
    requestRevoke,
    cancelRevoke: () => setConfirmRule(null),
    confirmRevoke,
  };
}

export function AllowedPage({ handle, onBack }: { handle: GroupRulesHandle; onBack: () => void }) {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScreenHeader variant="sub" title="Always allowed" onBack={onBack} />

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="px-2 pt-1">
          {handle.status === 'loading' ? (
            <StateMessage kind="loading" size="inline" title="Loading…" />
          ) : null}
          {handle.status === 'error' ? (
            <View className="gap-2 px-2">
              <Text accessibilityRole="alert" className="text-[13px] text-danger">
                {handle.error}
              </Text>
              <Button variant="outline" onPress={handle.retry} className="self-start">
                <Text>Retry</Text>
              </Button>
            </View>
          ) : null}
          {handle.status === 'ready' && handle.rules.length === 0 ? (
            <StateMessage kind="empty" size="inline" title="Nothing is always allowed here." />
          ) : null}
          {handle.status === 'ready'
            ? handle.rules.map((rule) => (
                <AlwaysAllowedRow
                  key={rule.id}
                  rule={rule}
                  confirming={false}
                  revoking={false}
                  onAsk={() => handle.requestRevoke(rule)}
                  onCancel={() => {}}
                  onConfirm={() => {}}
                />
              ))
            : null}
        </View>
      </ScrollView>

      <RevokeConfirmDialog
        rule={handle.confirmRule}
        busy={handle.revoking}
        error={handle.revokeError}
        onCancel={handle.cancelRevoke}
        onConfirm={handle.confirmRevoke}
      />
    </SafeAreaView>
  );
}
