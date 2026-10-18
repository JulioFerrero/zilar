import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, View, Pressable } from 'react-native';
import type { Effect } from 'effect';
import { ShieldCheck, Check, X } from 'lucide-react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { AisScreenShell } from '@/components/ais/screen-shell';
import { RevokeConfirmDialog, AlwaysAllowedRow } from '@/components/approvals/always-allowed-row';
import {
  useApprovals,
  type LoadStatus,
  type OwnedRule,
} from '@/components/approvals/use-approvals';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND, ACCENT, ACCENT_FOREGROUND, ICON } from '@/lib/colors';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/ui/card';
import type { ApprovalRule, ApprovalDecision, PublicApproval } from '@/lib/approvals-api';
import type { RowBusy } from '../../components/approvals/rows';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { IconButton } from '@/components/ui/icon-button';
import { useKeyPress } from '@/components/ui/use-key-press';
import { KEY_PRIMARY_PRESSED_SHADOW, pressStyle, primaryKey } from '@/lib/depth';
import { cn } from '@/lib/utils';

function PendingApprovalRow({
  approval,
  aiName,
  busy,
  actionError,
  last,
  onDecide,
}: {
  approval: PublicApproval;
  aiName: string;
  busy: RowBusy;
  actionError: string;
  last: boolean;
  onDecide: (id: string, decision: ApprovalDecision) => void;
}) {
  const name = approval.aiName === '' ? aiName : approval.aiName;
  const where =
    name === '' ? '' : approval.groupName === null ? name : `${name} · ${approval.groupName}`;
  const disabled = busy !== null;
  return (
    <View className={cn('flex-col', !last && 'border-b border-divider')}>
      <View className="flex-row items-center gap-3 p-3.5">
        <EntityAvatar person={{ id: approval.aiId, name }} size={40} ai />
        <View className="min-w-0 flex-1 flex-col gap-[3px]">
          <Text numberOfLines={2} className="text-[15px] font-medium">
            {approval.summary}
          </Text>
          {where !== '' ? (
            <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
              {where}
            </Text>
          ) : null}
        </View>
        <IconButton
          label={`Deny: ${approval.summary}`}
          className={disabled ? 'opacity-50' : undefined}
          disabled={disabled}
          onPress={() => onDecide(approval.id, 'deny')}
        >
          <X size={17} color={ICON} />
        </IconButton>
        <PrimaryIconKey
          label={`Approve: ${approval.summary}`}
          disabled={disabled}
          onPress={() => onDecide(approval.id, 'approve_once')}
        />
      </View>

      {actionError !== '' ? (
        <View className="px-4 pb-3.5">
          <Text accessibilityRole="alert" className="text-[13px] text-danger">
            {actionError}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The Approve key. The kit's `IconButton` is the dark icon key only, so this
 * uses the same 40 px, 12 radius recipe with the primary look (`depth.ts`).
 */
function PrimaryIconKey({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const { pressed, reduceMotion, setPressed } = useKeyPress();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      className={cn('h-10 w-10 items-center justify-center rounded-xl', disabled && 'opacity-50')}
      style={[primaryKey, pressStyle(pressed, KEY_PRIMARY_PRESSED_SHADOW, reduceMotion)]}
    >
      <Check size={17} color={ACCENT_FOREGROUND} />
    </Pressable>
  );
}

function PendingTab({
  rows,
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
    <View className="overflow-hidden rounded-xl border border-divider bg-surface">
      {rows.map((row, index) => (
        <DecidingRow
          key={row.approval.id}
          row={row}
          aiName={nameFor(row.approval.aiId)}
          last={index === rows.length - 1}
          onDecide={onDecide}
        />
      ))}
    </View>
  );
}

function DecidingRow({
  row,
  aiName,
  last,
  onDecide,
}: {
  row: { approval: PublicApproval; busy: RowBusy; error: string };
  aiName: string;
  last: boolean;
  onDecide: (id: string, decision: ApprovalDecision) => Effect.Effect<void>;
}) {
  const [, decideRun] = useAction((input: { id: string; decision: ApprovalDecision }) =>
    onDecide(input.id, input.decision),
  );
  return (
    <PendingApprovalRow
      approval={row.approval}
      aiName={aiName}
      busy={row.busy}
      actionError={row.error}
      last={last}
      onDecide={(id, decision) => decideRun({ id, decision })}
    />
  );
}

function RulesSection({
  status,
  sections,
  error,
  nameFor,
  onAsk,
  onRetry,
}: {
  status: LoadStatus;
  sections: { aiId: string; rules: ApprovalRule[] }[];
  error: string;
  nameFor: (aiId: string) => string;
  onAsk: (owned: OwnedRule) => void;
  onRetry: () => void;
}) {
  const count = sections.reduce((total, section) => total + section.rules.length, 0);
  return (
    <View className="mt-6 gap-2 border-t border-divider pt-4">
      <SectionLabel>Always allowed</SectionLabel>
      {status === 'loading' ? <StateMessage kind="loading" size="inline" title="Loading…" /> : null}
      {status === 'error' ? (
        <View className="gap-2">
          <Text accessibilityRole="alert" className="text-[14px] text-danger">
            {error}
          </Text>
          <Button variant="outline" size="sm" className="self-start" onPress={onRetry}>
            <Text>Retry</Text>
          </Button>
        </View>
      ) : null}
      {status === 'ready' && count === 0 ? (
        <Text className="text-[13px] text-muted-foreground">Nothing is always allowed here.</Text>
      ) : null}
      {status === 'ready' && count > 0
        ? sections.map((section) => (
            <View key={section.aiId} className="gap-1">
              <Text className="text-[13px] font-medium text-muted-foreground">
                {nameFor(section.aiId)}
              </Text>
              {section.rules.map((rule) => (
                <AlwaysAllowedRow
                  key={rule.id}
                  rule={rule}
                  confirming={false}
                  revoking={false}
                  onAsk={() => onAsk({ aiId: section.aiId, rule })}
                  onCancel={() => {}}
                  onConfirm={() => {}}
                />
              ))}
            </View>
          ))
        : null}
    </View>
  );
}

export type { OwnedRule } from '@/components/approvals/use-approvals';

export default function ApprovalsScreen() {
  return (
    <RequireAuth>
      <ApprovalsBody />
    </RequireAuth>
  );
}

function ApprovalsBody() {
  const router = useRouter();
  const {
    status,
    errorMessage,
    runLoad,
    refreshing,
    setRefreshing,
    notice,
    pendingList,
    now,
    nameFor,
    decide,
    rulesStatus,
    ruleSections,
    rulesError,
    runRules,
    askRevoke,
    confirmRule,
    setConfirmRule,
    revokeState,
    revokeError,
    confirmRevoke,
  } = useApprovals();

  return (
    <AisScreenShell
      title="Approvals"
      subtitle="Requests from your AIs that are waiting for you."
      onBack={() => router.back()}
    >
      {notice !== '' ? (
        <Text role="status" className="mb-3 text-[14px] text-muted-foreground">
          {notice}
        </Text>
      ) : null}

      {status === 'loading' ? <StateMessage kind="loading" title="Loading…" /> : null}

      {status === 'error' ? (
        <StateMessage
          kind="error"
          title={errorMessage}
          action={{ label: 'Retry', onPress: () => runLoad(true) }}
        />
      ) : null}

      {status === 'ready' ? (
        <ScrollView
          className="flex-1"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={MUTED_FOREGROUND}
              onRefresh={() => {
                setRefreshing(true);
                runLoad(false);
              }}
            />
          }
        >
          <PendingTab
            rows={pendingList}
            now={now}
            nameFor={nameFor}
            onDecide={decide}
            onRefresh={() => runLoad(false)}
          />

          <RulesSection
            status={rulesStatus}
            sections={ruleSections}
            error={rulesError}
            nameFor={nameFor}
            onAsk={askRevoke}
            onRetry={() => runRules(pendingList.map((row) => row.approval))}
          />
        </ScrollView>
      ) : null}

      <RevokeConfirmDialog
        rule={confirmRule?.rule ?? null}
        busy={isWaiting(revokeState)}
        error={revokeError}
        onCancel={() => setConfirmRule(null)}
        onConfirm={confirmRevoke}
      />
    </AisScreenShell>
  );
}
