import type { ApprovalRequest } from '@galena/protocol';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useApprovalsApi } from './use-approvals-api';
import { Button } from '../ui/button';
import { Text } from '../ui/text';
import { useKeyPress } from '../ui/use-key-press';
import {
  ApprovalsApiError,
  type ApprovalDecision,
  type ApprovalsApi,
  type PublicApproval,
} from '../../lib/approvals-api';
import { formatMoney } from '../../lib/chat';
import { KEY_ICON_PRESSED_SHADOW, iconKey, pressStyle } from '../../lib/depth';

export type ApprovalCardState =
  | { kind: 'loading' }
  | { kind: 'notDecidable' }
  | { kind: 'error' }
  | { kind: 'ready'; approval: PublicApproval };

export function approvalStatusLabel(approval: PublicApproval): string {
  switch (approval.status) {
    case 'pending':
      return 'Pending';
    case 'approved_once':
    case 'approved_always':
      return 'Approved';
    case 'denied':
      return 'Denied';
    case 'consumed':
      return 'Already used';
    case 'expired':
      return 'Expired';
  }
}

// A 404 means the viewer may not decide this request (or it does not exist):
// the card then shows no buttons and no error. Any other failure on the first
// load surfaces the request text with a Retry button.
export async function loadApprovalCardState(
  api: ApprovalsApi,
  approvalId: string,
): Promise<ApprovalCardState> {
  try {
    return { kind: 'ready', approval: await api.getApproval(approvalId) };
  } catch (error) {
    if (error instanceof ApprovalsApiError && error.status === 404) {
      return { kind: 'notDecidable' };
    }
    return { kind: 'error' };
  }
}

// The decide flow: success replaces the row; a 409 (race / expired) reloads the
// row so the card shows the latest state; any other error returns the message
// to surface inline. The caller drives `inFlight` itself.
export type DecisionOutcome =
  | { kind: 'ready'; approval: PublicApproval }
  | { kind: 'reloaded'; approval: PublicApproval | null }
  | { kind: 'error'; message: string };

export async function applyDecision(
  api: ApprovalsApi,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<DecisionOutcome> {
  try {
    const approval = await api.decideApproval(approvalId, decision);
    return { kind: 'ready', approval };
  } catch (error) {
    if (
      error instanceof ApprovalsApiError &&
      (error.code === 'not_pending' || error.code === 'expired')
    ) {
      const refreshed = await api.getApproval(approvalId).catch(() => null);
      return { kind: 'reloaded', approval: refreshed };
    }
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : 'Could not send the decision',
    };
  }
}

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
