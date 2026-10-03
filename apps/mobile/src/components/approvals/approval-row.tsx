import { ShieldAlert } from 'lucide-react-native';
import { View } from 'react-native';
import { useColorScheme } from 'nativewind';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { approvalStatusLabel } from '@/lib/approval-state';
import { asColorScheme } from '@/lib/color-scheme';
import { ACCENT } from '@/lib/colors';
import type { PublicApproval } from '@/lib/approvals-api';

import { decidedAgoText, expiresInText, worstCaseText } from './format-relative';
import { SCREEN_DECISIONS, type RowBusy } from './rows';
import type { ApprovalDecision } from '@/lib/approvals-api';

/**
 * One pending approval in the inbox: AI, summary, worst case, the relative
 * expiry, and Approve once / Always / Deny. Mirrors web's `ApprovalRow`.
 */
export function PendingApprovalRow({
  approval,
  aiName,
  now,
  busy,
  actionError,
  onDecide,
}: {
  approval: PublicApproval;
  /** The AI's display name when the list of AIs loaded; the id otherwise. */
  aiName: string;
  now: Date;
  busy: RowBusy;
  actionError: string;
  onDecide: (id: string, decision: ApprovalDecision) => void;
}) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const cost = worstCaseText(approval.worstCase);
  return (
    <View className="gap-2 rounded-xl border border-divider bg-surface p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 flex-row items-center gap-2">
          <ShieldAlert size={16} color={ACCENT[scheme]} aria-hidden />
          <Text numberOfLines={1} className="min-w-0 flex-1 text-[16px] font-semibold">
            {approval.action}
          </Text>
        </View>
        <View className="shrink-0 rounded-full bg-badge-muted px-2 py-0.5">
          <Text className="text-[11px]">pending</Text>
        </View>
      </View>

      <Text className="text-[14px] text-muted-foreground">
        {aiName} · {approval.summary}
      </Text>

      {approval.details !== null ? (
        <Text className="text-[13px] leading-5 text-muted-foreground">{approval.details}</Text>
      ) : null}

      {cost !== '' ? <Text className="text-[13px] text-muted-foreground">{cost}</Text> : null}

      <Text className="text-[13px] text-muted-foreground">
        expires {expiresInText(approval.expiresAt, now)}
      </Text>

      <View className="flex-row flex-wrap gap-2">
        {SCREEN_DECISIONS.map((option) => (
          <Button
            key={option.decision}
            size="sm"
            variant={option.decision === 'deny' ? 'outline' : 'default'}
            className="px-3"
            disabled={busy !== null}
            accessibilityLabel={`${option.label} ${approval.action}`}
            onPress={() => onDecide(approval.id, option.decision)}
          >
            <Text>{busy === option.decision ? option.busyLabel : option.label}</Text>
          </Button>
        ))}
      </View>

      {actionError !== '' ? (
        <Text accessibilityRole="alert" className="text-[13px] text-danger">
          {actionError}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * One decided approval: read-only, with the decision and when it happened.
 * The server has no history endpoint, so these are rows the viewer decided
 * in this session (kept in memory) plus anything no longer pending.
 */
export function HistoryApprovalRow({
  approval,
  aiName,
  now,
}: {
  approval: PublicApproval;
  aiName: string;
  now: Date;
}) {
  return (
    <View className="gap-1.5 rounded-xl border border-divider bg-surface p-4">
      <View className="flex-row items-start justify-between gap-3">
        <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] font-semibold">
          {approval.action}
        </Text>
        <View className="shrink-0 rounded-full bg-badge-muted px-2 py-0.5">
          <Text className="text-[11px]">{approvalStatusLabel(approval)}</Text>
        </View>
      </View>
      <Text className="text-[13px] text-muted-foreground">
        {aiName} · {approval.summary}
      </Text>
      <Text className="text-[12px] text-muted-foreground">
        {approval.decidedAt !== null ? decidedAgoText(approval.decidedAt, now) : 'Decided'}
      </Text>
    </View>
  );
}
