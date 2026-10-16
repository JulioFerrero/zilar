import { routineCardTitle } from '@zilar/chat-core';
import type { ApprovalRequest } from '@zilar/protocol';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Check, Repeat, X } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useApprovalsApi } from '@/components/chat/use-approvals-api';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useKeyPress } from '@/components/ui/use-key-press';
import type {
  ApprovalDecision,
  ApprovalStatus,
  ApprovalsApi,
  PublicApproval,
} from '@/lib/approvals-api';
import { applyDecision, loadApprovalCardState, type ApprovalCardState } from '@/lib/approval-state';
import { DANGER, MUTED_FOREGROUND, SEEN } from '@/lib/colors';
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

/** "<AI> asks", the summary, Deny/Approve, and a quiet "Always allow" when eligible. */
export function ApprovalCard({ data }: { data: ApprovalRequest }) {
  const { api } = useApprovalsApi();
  // The read runs on mount and when the api or the request changes; Retry refreshes it.
  const [loaded, reload] = useQuery(
    () => Effect.promise(() => loadApprovalCardState(api, data.id)),
    [api, data.id],
  );
  const [decided, setDecided] = useState<DecidedCard | null>(null);
  const [inFlight, setInFlight] = useState<null | 'approve' | 'deny' | 'always'>(null);
  // T-0100's two-step confirm, kept: the first tap arms, the second decides.
  const [confirmingAlways, setConfirmingAlways] = useState(false);
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
  const showAlways = approval !== null && isPending && approval.alwaysEligible;
  const busy = inFlight !== null;
  // The last decision's inline failure, hidden while a new decision runs.
  const outcome =
    !isWaiting(decision) && AsyncResult.isSuccess(decision) ? decision.value : undefined;
  const actionError = outcome?.kind === 'error' ? outcome.message : '';

  const startDecision = (next: ApprovalDecision): void => {
    setInFlight(next === 'deny' ? 'deny' : next === 'approve_always' ? 'always' : 'approve');
    decide(next);
  };

  // The one-line label: the AI's name when the read carries one, "Approval" otherwise.
  const label =
    approval !== null && approval.aiName !== '' ? `${approval.aiName} asks` : 'Approval';

  // T-1723: a routine card's summary holds the title and the schedule; draw
  // them apart, null for every other card.
  const routine = routineCardTitle(data.action, data.summary);

  // A decided request shrinks to one line: a status icon and the summary.
  if (approval !== null && !isPending) {
    return (
      <View className="min-w-[230px] py-0.5">
        <View className="flex-row items-center gap-2">
          <DecidedIcon status={approval.status} />
          {routine === null ? (
            <Text className="min-w-0 flex-1 text-[14px] text-muted-foreground">{data.summary}</Text>
          ) : (
            <>
              <Text className="min-w-0 flex-1 text-[14px] text-muted-foreground">
                {routine.title}
              </Text>
              <Text className="font-mono text-[12px] text-muted-foreground">
                {routine.schedule}
              </Text>
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <View className="min-w-[230px] gap-2 py-0.5">
      <View className="gap-1">
        <Text className="text-[13px] text-muted-foreground">{label}</Text>
        {routine === null ? (
          <Text className="text-[16px] font-semibold text-foreground">{data.summary}</Text>
        ) : (
          <View className="flex-row items-center gap-2">
            <Repeat size={15} color={MUTED_FOREGROUND} aria-hidden />
            <Text className="min-w-0 flex-1 text-[16px] font-semibold text-foreground">
              {routine.title}
            </Text>
            <Text className="font-mono text-[12px] text-muted-foreground">{routine.schedule}</Text>
          </View>
        )}
      </View>

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

      {isPending ? (
        <View className="gap-2">
          <View className="flex-row gap-2">
            <Button
              variant="outline"
              className="h-11 flex-1"
              disabled={busy}
              accessibilityLabel="Deny"
              onPress={() => startDecision('deny')}
            >
              <Text>{inFlight === 'deny' ? 'Denying…' : 'Deny'}</Text>
            </Button>
            <Button
              variant="key"
              className="h-11 flex-1"
              disabled={busy}
              accessibilityLabel="Approve"
              onPress={() => startDecision('approve_once')}
            >
              <Text>{inFlight === 'approve' ? 'Approving…' : 'Approve'}</Text>
            </Button>
          </View>

          {showAlways ? (
            <Button
              variant="ghost"
              className="h-9 self-center px-2"
              disabled={busy}
              accessibilityLabel="Always allow"
              onPress={() =>
                confirmingAlways ? startDecision('approve_always') : setConfirmingAlways(true)
              }
            >
              <Text className="text-[13px] font-medium text-muted-foreground">
                {inFlight === 'always'
                  ? 'Allowing…'
                  : confirmingAlways
                    ? 'Tap again to always allow'
                    : 'Always allow'}
              </Text>
            </Button>
          ) : null}

          {actionError !== '' ? (
            <Text className="text-[12px] text-muted-foreground">{actionError}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** The decided status as one icon: a green check, or a red cross when not approved. */
function DecidedIcon({ status }: { status: ApprovalStatus }) {
  if (status === 'denied' || status === 'expired') {
    return <X size={14} color={DANGER} aria-hidden />;
  }
  return <Check size={14} color={SEEN} aria-hidden />;
}
