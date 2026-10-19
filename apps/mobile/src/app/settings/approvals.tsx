import { useFocusEffect, useRouter } from 'expo-router';
import { RefreshControl, ScrollView, View, Pressable } from 'react-native';
import { Effect } from 'effect';
import { ShieldCheck, Check, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { RequireAuth } from '@/auth/RequireAuth';
import { AisScreenShell } from '@/components/ais/screen-shell';
import { fromApi, makeAisApi, makeApprovalsApi } from '@zilar/client-core';
import { RevokeConfirmDialog, AlwaysAllowedRow } from '@/components/approvals/always-allowed-row';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND, ACCENT, ACCENT_FOREGROUND, ICON } from '@/lib/colors';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/ui/card';
import type { ApprovalRule, ApprovalDecision, PublicApproval } from '@/lib/approvals-api';
import { useApi } from '@/lib/use-mockable-api';
import {
  claimDecision,
  confirmationForDecision,
  decideScreenRow,
  groupRulesForScreen,
  mergeRulesFanOut,
  orderedRows,
  revokeFailedOutcome,
  rowsForList,
  type DecideOutcome,
  type OwnedScreenRule,
  type RowsById,
  type RowBusy,
} from '@/components/approvals/rows';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { IconButton } from '@/components/ui/icon-button';
import { useKeyPress } from '@/components/ui/use-key-press';
import { KEY_PRIMARY_PRESSED_SHADOW, pressStyle, primaryKey } from '@/lib/depth';
import { cn } from '@/lib/utils';

type LoadStatus = 'loading' | 'ready' | 'error';

/** A rule with the AI id re-attached: the rule route is per AI (`/ais/:id/…`). */
type OwnedRule = OwnedScreenRule;

const NOTICE_TIMEOUT_MS = 4000;
const CLOCK_TICK_MS = 60_000;

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

export default function ApprovalsScreen() {
  return (
    <RequireAuth>
      <ApprovalsBody />
    </RequireAuth>
  );
}

function ApprovalsBody() {
  const router = useRouter();
  const { api } = useApi(makeApprovalsApi);
  const { api: aisApi } = useApi(makeAisApi);

  const [rows, setRows] = useState<RowsById>({});
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  // Requests decided in this session: an in-flight list that lands after the
  // decision must not bring their rows back.
  const decidedIds = useRef(new Set<string>());
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState<Date>(() => new Date());

  const [aiNames, setAiNames] = useState<Record<string, string>>({});
  const [ownedRules, setOwnedRules] = useState<OwnedRule[]>([]);
  const [rulesStatus, setRulesStatus] = useState<LoadStatus>('loading');
  const [rulesError, setRulesError] = useState('');
  const [confirmRule, setConfirmRule] = useState<OwnedRule | null>(null);
  const [revokeError, setRevokeError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  // Per-id in-flight guard: a second tap while the first POST is running does
  // nothing (the disabled button alone cannot stop a tap before React re-renders).
  const decidingIds = useRef(new Set<string>());

  const [, showNotice] = useAction(
    (message: string) =>
      Effect.sync(() => setNotice(message)).pipe(
        Effect.andThen(Effect.sleep(NOTICE_TIMEOUT_MS)),
        Effect.andThen(Effect.sync(() => setNotice(''))),
      ),
    { mode: 'replace' },
  );

  const [, runLoad] = useAction(
    (showLoading: boolean) =>
      Effect.sync(() => {
        if (showLoading) {
          setStatus('loading');
        }
      }).pipe(
        Effect.andThen(
          Effect.tryPromise({
            try: () => api.listApprovals(),
            catch: (cause: unknown) =>
              cause instanceof Error ? cause : new Error('Could not load approvals.'),
          }),
        ),
        Effect.tap((list) =>
          Effect.sync(() => {
            const visible = list.filter((approval) => !decidedIds.current.has(approval.id));
            setRows((previous) => rowsForList(visible, previous, decidingIds.current));
            setStatus('ready');
            setErrorMessage('');
          }),
        ),
        Effect.catch((error: Error) =>
          Effect.sync(() => {
            setStatus('error');
            setErrorMessage(error.message);
          }),
        ),
        Effect.ensuring(Effect.sync(() => setRefreshing(false))),
      ),
    { mode: 'replace' },
  );

  // One AI-list fetch for display names; it goes through `useApi` so mock
  // mode reads the mock AIs, and a failure leaves the names empty.
  const aiList = Effect.tryPromise({
    try: () => aisApi.listAis(),
    catch: () => undefined,
  }).pipe(
    Effect.catch(() => Effect.succeed(undefined)),
    Effect.map((list) => list ?? []),
  );

  const [, runRules] = useAction(
    (pending: PublicApproval[]) =>
      Effect.sync(() => setRulesStatus('loading')).pipe(
        // One rules fetch per AI the person owns, even with nothing pending: a
        // standing rule must stay revocable. Group rules are out of scope.
        Effect.andThen(aiList),
        Effect.flatMap((ais) => {
          const names: Record<string, string> = {};
          for (const ai of ais) {
            names[ai.id] = ai.name;
          }
          setAiNames(names);
          const aiIds = [
            ...new Set([...ais.map((ai) => ai.id), ...pending.map((approval) => approval.aiId)]),
          ];
          // One AI's rules failure must not blank the others: `mergeRulesFanOut`
          // skips it, and only when every AI fails does the section show an error.
          return Effect.forEach(
            aiIds,
            (aiId) =>
              fromApi(() => api.listAiApprovalRules(aiId)).pipe(
                Effect.map((rules) => ({ status: 'fulfilled' as const, value: { aiId, rules } })),
                Effect.catch((reason) => Effect.succeed({ status: 'rejected' as const, reason })),
              ),
            { concurrency: 'unbounded' },
          );
        }),
        Effect.tap((settled) =>
          Effect.sync(() => {
            const merged = mergeRulesFanOut(settled);
            if (merged === null) {
              setRulesStatus('error');
              setRulesError('Could not load the rules.');
              return;
            }
            setOwnedRules(merged);
            setRulesStatus('ready');
            setRulesError('');
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            setRulesStatus('error');
            setRulesError('Could not load the rules.');
          }),
        ),
      ),
    { mode: 'replace' },
  );

  useEffect(() => {
    runLoad(true);
  }, [runLoad]);

  // Refresh on focus so coming back from a chat picks up decisions from elsewhere.
  useFocusEffect(
    useCallback(() => {
      runLoad(false);
    }, [runLoad]),
  );

  // Tick `now` every minute so the "expires in" countdown updates without a
  // full reload.
  const [, startClock, clockControls] = useAction<void, void, never>(() =>
    Effect.forever(
      Effect.sleep(CLOCK_TICK_MS).pipe(Effect.andThen(Effect.sync(() => setNow(new Date())))),
    ),
  );
  useEffect(() => {
    startClock();
    return () => clockControls.interrupt();
  }, [startClock, clockControls]);

  const pendingList = useMemo(() => orderedRows(rows), [rows]);
  const pendingAiKey = useMemo(
    () => [...new Set(pendingList.map((row) => row.approval.aiId))].join(','),
    [pendingList],
  );
  useEffect(() => {
    if (status === 'ready') {
      runRules(pendingList.map((row) => row.approval));
    }
    // Runs when the pending AI set changes, not every render: `pendingList` is
    // rebuilt per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAiKey, status]);

  const applyDecisionOutcome = (
    id: string,
    decision: ApprovalDecision,
    outcome: DecideOutcome,
  ): void => {
    if (outcome.kind === 'decided') {
      decidedIds.current.add(id);
      setRows((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      showNotice(confirmationForDecision(decision));
    } else if (outcome.kind === 'gone') {
      // Decided or expired elsewhere: drop the row and explain, rather than
      // failing silently.
      decidedIds.current.add(id);
      setRows((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      showNotice(outcome.message);
    } else if (outcome.kind === 'stale') {
      // The 409 race reloaded a row that is still pending: the decision did not
      // land, so the row stays with the refreshed server state and no error.
      setRows((previous) => {
        const current = previous[id];
        if (current === undefined) {
          return previous;
        }
        return {
          ...previous,
          [id]: { approval: outcome.approval, busy: null, error: '' },
        };
      });
    } else {
      // Offline, 500, 403, …: clear `busy` and show the fixed inline message so
      // the buttons work again.
      setRows((previous) => {
        const current = previous[id];
        if (current === undefined) {
          return previous;
        }
        return { ...previous, [id]: { ...current, busy: null, error: outcome.message } };
      });
    }
  };

  // One decision for one row: the row's action blocks a second tap, the claim
  // keeps the id busy until the POST settles.
  const decide = (id: string, decision: ApprovalDecision): Effect.Effect<void> => {
    if (!claimDecision(decidingIds.current, id)) {
      return Effect.void;
    }
    return Effect.sync(() => {
      setRows((previous) => {
        const current = previous[id];
        if (current === undefined) {
          decidingIds.current.delete(id);
          return previous;
        }
        return { ...previous, [id]: { ...current, busy: decision, error: '' } };
      });
    }).pipe(
      Effect.andThen(Effect.promise(() => decideScreenRow(api, id, decision))),
      Effect.tap((outcome) => Effect.sync(() => applyDecisionOutcome(id, decision, outcome))),
      Effect.ensuring(Effect.sync(() => decidingIds.current.delete(id))),
    );
  };

  const askRevoke = useCallback((owned: OwnedRule) => {
    setRevokeError('');
    setConfirmRule(owned);
  }, []);

  const [revokeState, runRevoke] = useAction((id: string) =>
    Effect.tryPromise({
      try: () => api.revokeApprovalRule(id),
      catch: (error: unknown) => revokeFailedOutcome(error),
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          setOwnedRules((previous) => previous.filter((owned) => owned.rule.id !== id));
          setConfirmRule(null);
        }),
      ),
      Effect.catch((outcome: { dropped: boolean; message: string }) =>
        Effect.sync(() => {
          if (outcome.dropped) {
            // Already gone (revoked elsewhere): drop the row quietly.
            setOwnedRules((previous) => previous.filter((owned) => owned.rule.id !== id));
            setConfirmRule(null);
          } else {
            setRevokeError(outcome.message);
          }
        }),
      ),
    ),
  );

  const confirmRevoke = (): void => {
    if (confirmRule === null || isWaiting(revokeState)) {
      return;
    }
    setRevokeError('');
    runRevoke(confirmRule.rule.id);
  };

  const nameFor = useCallback((aiId: string) => aiNames[aiId] ?? aiId, [aiNames]);

  const ruleSections = useMemo(() => groupRulesForScreen(ownedRules), [ownedRules]);

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
