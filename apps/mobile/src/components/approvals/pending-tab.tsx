import type { Effect } from 'effect';
import { ShieldCheck } from 'lucide-react-native';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import type { ApprovalDecision, PublicApproval } from '@/lib/approvals-api';
import { ACCENT } from '@/lib/colors';
import { useAction } from '@/lib/effect/use-action';

import { PendingApprovalRow } from './approval-row';
import type { RowBusy } from './rows';

export function PendingTab({
  rows,
  now,
  nameFor,
  onDecide,
  onRefresh,
}: {
  rows: { approval: PublicApproval; busy: RowBusy; error: string }[];
  now: Date;
  nameFor: (aiId: string) => string;
  onDecide: (id: string, decision: ApprovalDecision) => Effect.Effect<void>;
  onRefresh: () => void;
}) {
  if (rows.length === 0) {
    return (
      <View className="items-center gap-3 py-10">
        <ShieldCheck size={32} color={ACCENT} aria-hidden />
        <Text className="px-4 text-center text-[15px] text-muted-foreground">
          Nothing is waiting for you.
        </Text>
        <Button variant="outline" size="sm" onPress={onRefresh}>
          <Text>Refresh</Text>
        </Button>
      </View>
    );
  }
  return (
    <View className="gap-2">
      {rows.map((row) => (
        <DecidingRow
          key={row.approval.id}
          row={row}
          aiName={nameFor(row.approval.aiId)}
          now={now}
          onDecide={onDecide}
        />
      ))}
    </View>
  );
}

/** One pending row with its own decision action, so a tap on one row never waits on another. */
function DecidingRow({
  row,
  aiName,
  now,
  onDecide,
}: {
  row: { approval: PublicApproval; busy: RowBusy; error: string };
  aiName: string;
  now: Date;
  onDecide: (id: string, decision: ApprovalDecision) => Effect.Effect<void>;
}) {
  const [, decideRun] = useAction((input: { id: string; decision: ApprovalDecision }) =>
    onDecide(input.id, input.decision),
  );
  return (
    <PendingApprovalRow
      approval={row.approval}
      aiName={aiName}
      now={now}
      busy={row.busy}
      actionError={row.error}
      onDecide={(id, decision) => decideRun({ id, decision })}
    />
  );
}
