import type { ApprovalRequest } from '@zilar/protocol';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useApprovalsApi } from '@/components/chat/use-approvals-api';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useKeyPress } from '@/components/ui/use-key-press';
import type { ApprovalDecision, ApprovalsApi, PublicApproval } from '@/lib/approvals-api';
import {
  applyDecision,
  approvalStatusLabel,
  loadApprovalCardState,
  type ApprovalCardState,
} from '@/lib/approval-state';
import { formatMoney } from '@/lib/chat';
import { KEY_ICON_PRESSED_SHADOW, iconKey, pressStyle } from '@/lib/depth';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';

function ApprovalRetryButton({ onPress }: { onPress: () => void }) {
  const { pressed, reduceMotion, setPressed } = useKeyPress();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Retry"
      onPress={onPress}
      className="h-8 items-center justify-center rounded-xl px-3"
      style={[iconKey, pressStyle(pressed, KEY_ICON_PRESSED_SHADOW, reduceMotion)]}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
    >
      <Text className="text-[13px] font-medium text-foreground">Retry</Text>
    </Pressable>
  );
}

/** A decision the viewer made, kept with the api and request it was made for. */
interface DecidedCard {
  readonly api: ApprovalsApi;
  readonly id: string;
  readonly approval: PublicApproval;
}

/** Title, summary, cost and Approve (primary key) / Deny (outline key). */
export function ApprovalCard({ data }: { data: ApprovalRequest }) {
  const { api } = useApprovalsApi();
  // The read runs on mount and when the api or the request changes; Retry refreshes it.
  const [loaded, reload] = useQuery(
    () => Effect.promise(() => loadApprovalCardState(api, data.id)),
    [api, data.id],
  );
  const [decided, setDecided] = useState<DecidedCard | null>(null);
  const [inFlight, setInFlight] = useState<null | 'approve' | 'deny'>(null);
  const [decision, decide] = useAction((next: ApprovalDecision) =>
    Effect.promise(() => applyDecision(api, data.id, next)).pipe(
      Effect.tap((outcome) =>
        Effect.sync(() => {
          if (
            (outcome.kind === 'ready' || outcome.kind === 'reloaded') &&
            outcome.approval !== null
          ) {
            setDecided({ api, id: data.id, approval: outcome.approval });
          }
        }),
      ),
      Effect.ensuring(Effect.sync(() => setInFlight(null))),
    ),
  );

  // A read that is still running (first load, Retry) shows the placeholder.
  const loadedState: ApprovalCardState =
    AsyncResult.isSuccess(loaded) && !isWaiting(loaded) ? loaded.value : { kind: 'loading' };
  // A decision made on this request wins over the read.
  const state: ApprovalCardState =
    decided !== null && decided.api === api && decided.id === data.id
      ? { kind: 'ready', approval: decided.approval }
      : loadedState;
  const approval = state.kind === 'ready' ? state.approval : null;
  // The server turns a past-due `pending` row into `expired` in its read model
  // (see `toPublicApproval`), so a `pending` status is already "pending and
  // not expired" from the user's perspective.
  const isPending = approval !== null && approval.status === 'pending';
  const busy = inFlight !== null;
  // The last decision's inline failure, hidden while a new decision runs.
  const outcome =
    !isWaiting(decision) && AsyncResult.isSuccess(decision) ? decision.value : undefined;
  const actionError = outcome?.kind === 'error' ? outcome.message : '';

  const startDecision = (next: ApprovalDecision): void => {
    setInFlight(next === 'deny' ? 'deny' : 'approve');
    decide(next);
  };

  return (
    <View className="min-w-[230px] gap-2 py-0.5">
      <Text className="text-[15px] font-semibold text-foreground">{data.action}</Text>
      <Text className="text-[13px] leading-4 text-muted-foreground">{data.summary}</Text>
      {data.details !== undefined ? (
        <Text className="text-[12px] leading-4 text-muted-foreground">{data.details}</Text>
      ) : null}
      {data.worst_case_cost !== undefined ? (
        <Text className="text-[13px] text-muted-foreground">
          Max cost: {formatMoney(data.worst_case_cost)}
        </Text>
      ) : null}

      {state.kind === 'loading' ? (
        <View
          accessibilityRole="text"
          aria-hidden
          accessible={false}
          className="mt-1 h-7 w-32 rounded-md bg-surface-raised"
        />
      ) : null}

      {state.kind === 'notDecidable' ? (
        <Text className="text-[12px] text-muted-foreground">Waiting for a decision</Text>
      ) : null}

      {state.kind === 'error' ? (
        <View className="mt-1 gap-2">
          <Text className="text-[12px] text-muted-foreground">
            Could not load the decision state
          </Text>
          <View>
            <ApprovalRetryButton onPress={reload} />
          </View>
        </View>
      ) : null}

      {approval !== null && !isPending ? (
        <Text className="text-[12px] text-muted-foreground">{approvalStatusLabel(approval)}</Text>
      ) : null}

      {isPending ? (
        <View className="mt-1 gap-2">
          <View className="flex-row gap-2">
            <Button
              variant="key"
              size="sm"
              className="flex-1"
              disabled={busy}
              accessibilityLabel="Approve"
              onPress={() => startDecision('approve_once')}
            >
              <Text>{inFlight === 'approve' ? 'Approving…' : 'Approve'}</Text>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={busy}
              accessibilityLabel="Deny"
              onPress={() => startDecision('deny')}
            >
              <Text>{inFlight === 'deny' ? 'Denying…' : 'Deny'}</Text>
            </Button>
          </View>
          {actionError !== '' ? (
            <Text className="text-[12px] text-muted-foreground">{actionError}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
