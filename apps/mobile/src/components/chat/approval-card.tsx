import type { ApprovalRequest } from '@galena/protocol';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useApprovalsApi } from '@/components/chat/use-approvals-api';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useKeyPress } from '@/components/ui/use-key-press';
import type { ApprovalDecision } from '@/lib/approvals-api';
import {
  applyDecision,
  approvalStatusLabel,
  loadApprovalCardState,
  type ApprovalCardState,
} from '@/lib/approval-state';
import { formatMoney } from '@/lib/chat';
import { KEY_ICON_PRESSED_SHADOW, iconKey, pressStyle } from '@/lib/depth';

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

/** Title, summary, cost and Approve (primary key) / Deny (outline key). */
export function ApprovalCard({ data }: { data: ApprovalRequest }) {
  const { api } = useApprovalsApi();
  const [state, setState] = useState<ApprovalCardState>({ kind: 'loading' });
  const [inFlight, setInFlight] = useState<null | 'approve' | 'deny'>(null);
  const [actionError, setActionError] = useState('');

  const reload = useCallback(() => {
    setState({ kind: 'loading' });
    void loadApprovalCardState(api, data.id).then(setState);
  }, [api, data.id]);

  useEffect(() => {
    let active = true;
    void loadApprovalCardState(api, data.id).then((next) => {
      if (active) {
        setState(next);
      }
    });
    return () => {
      active = false;
    };
  }, [api, data.id]);

  const decide = useCallback(
    async (decision: ApprovalDecision) => {
      setActionError('');
      setInFlight(decision === 'deny' ? 'deny' : 'approve');
      const outcome = await applyDecision(api, data.id, decision);
      try {
        if (outcome.kind === 'ready' || outcome.kind === 'reloaded') {
          if (outcome.approval !== null) {
            setState({ kind: 'ready', approval: outcome.approval });
          }
        } else {
          setActionError(outcome.message);
        }
      } finally {
        setInFlight(null);
      }
    },
    [api, data.id],
  );

  const approval = state.kind === 'ready' ? state.approval : null;
  // The server turns a past-due `pending` row into `expired` in its read model
  // (see `toPublicApproval`), so a `pending` status is already "pending and
  // not expired" from the user's perspective.
  const isPending = approval !== null && approval.status === 'pending';
  const busy = inFlight !== null;

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
              onPress={() => {
                void decide('approve_once');
              }}
            >
              <Text>{inFlight === 'approve' ? 'Approving…' : 'Approve'}</Text>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={busy}
              accessibilityLabel="Deny"
              onPress={() => {
                void decide('deny');
              }}
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
