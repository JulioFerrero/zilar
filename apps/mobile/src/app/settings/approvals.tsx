import { Effect } from 'effect';
import { useFocusEffect, useRouter } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useColorScheme } from 'nativewind';

import { RequireAuth } from '@/auth/RequireAuth';
import { AisScreenShell } from '@/components/ais/screen-shell';
import { useApprovalsApi } from '@/components/chat/use-approvals-api';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { createAisApi } from '@/lib/ais-api';
import type { ApprovalDecision, ApprovalRule, PublicApproval } from '@/lib/approvals-api';
import { asColorScheme } from '@/lib/color-scheme';
import { ACCENT, MUTED_FOREGROUND } from '@/lib/colors';
import { fromApi } from '@/lib/effect/api-effect';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { getSessionToken } from '@/lib/session-token';

import { AlwaysAllowedRow, RevokeConfirmDialog } from '@/components/approvals/always-allowed-row';
import { PendingApprovalRow } from '@/components/approvals/approval-row';
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

type LoadStatus = 'loading' | 'ready' | 'error';

/** A rule with the AI id re-attached: the rule route is per AI (`/ais/:id/…`) but the row carries none. */
export type OwnedRule = OwnedScreenRule;

const NOTICE_TIMEOUT_MS = 4000;
const CLOCK_TICK_MS = 60_000;

export default function ApprovalsScreen() {
  return (
    <RequireAuth>
      <ApprovalsBody />
    </RequireAuth>
  );
}

function ApprovalsBody() {
  const router = useRouter();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const { api } = useApprovalsApi();

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
  // Per-id in-flight guard: a second tap while the first POST is running
  // does nothing (the disabled button alone cannot stop a tap that lands
  // before React re-renders).
  const decidingIds = useRef(new Set<string>());

  // The confirmation line after a decision ("Approved once", …) shows for a
  // few seconds where the row was, then clears itself. A newer line replaces
  // the timer; unmounting interrupts it.
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

  // One AI-list fetch for display names; a failure leaves the names empty.
  const aiList = Effect.tryPromise({
    try: () => createAisApi(getSessionToken).listAis(),
    catch: () => undefined,
  }).pipe(
    Effect.catch(() => Effect.succeed(undefined)),
    Effect.map((list) => list ?? []),
  );

  const [, runRules] = useAction(
    (pending: PublicApproval[]) =>
      Effect.sync(() => setRulesStatus('loading')).pipe(
        // One AI-list fetch for display names, then one rules fetch per AI the
        // person owns, whether or not it has a pending request (a standing
        // rule must stay revocable). Group rules are out of scope: T-0184.
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
          // One AI's rules failure must not blank the others: each AI is
          // handled on its own (`mergeRulesFanOut` skips failures), and only
          // when every AI fails does the section show the error state.
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

  // The first load.
  useEffect(() => {
    runLoad(true);
  }, [runLoad]);

  // Refresh when the screen regains focus so coming back from a chat picks
  // up anything decided elsewhere.
  useFocusEffect(
    useCallback(() => {
      runLoad(false);
    }, [runLoad]),
  );

  // Tick `now` every minute so the "expires in" countdown updates without a
  // full reload. Unmounting interrupts the tick.
  const [, startClock, clockControls] = useAction<void, void, never>(() =>
    Effect.forever(
      Effect.sleep(CLOCK_TICK_MS).pipe(Effect.andThen(Effect.sync(() => setNow(new Date())))),
    ),
  );
  useEffect(() => {
    startClock();
    return () => clockControls.interrupt();
  }, [startClock, clockControls]);

  // The rules ride the pending rows' AI ids; reload them once pending loaded.
  const pendingList = useMemo(() => orderedRows(rows), [rows]);
  const pendingAiKey = useMemo(
    () => [...new Set(pendingList.map((row) => row.approval.aiId))].join(','),
    [pendingList],
  );
  useEffect(() => {
    if (status === 'ready') {
      runRules(pendingList.map((row) => row.approval));
    }
    // Runs when the pending AI set (or its readiness) changes, not on every
    // row render: `pendingList` is rebuilt per render.
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
      // Decided or expired elsewhere: drop the row and explain, instead
      // of failing silently.
      decidedIds.current.add(id);
      setRows((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      showNotice(outcome.message);
    } else if (outcome.kind === 'stale') {
      // The 409 race reloaded a row that is still pending: the decision
      // did not land, so the row stays in the list with the refreshed
      // server state and no error.
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
      // Offline, 500, 403, …: clear `busy` and show the fixed inline
      // message so the buttons work again and the person can retry.
      setRows((previous) => {
        const current = previous[id];
        if (current === undefined) {
          return previous;
        }
        return { ...previous, [id]: { ...current, busy: null, error: outcome.message } };
      });
    }
  };

  // One decision for one row. The row's own action keeps a second tap from
  // starting it again; the claim keeps the id busy until the POST settles.
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

  // A second confirm while one revoke runs is dropped by the action itself.
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
            // Already gone (revoked elsewhere): drop the row quietly, like a
            // successful revoke.
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
              tintColor={MUTED_FOREGROUND[scheme]}
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

function PendingTab({
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
  const scheme = asColorScheme(useColorScheme().colorScheme);
  if (rows.length === 0) {
    return (
      <View className="items-center gap-3 py-10">
        <ShieldCheck size={32} color={ACCENT[scheme]} aria-hidden />
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
      <Text className="text-[16px] font-semibold">Always allowed</Text>
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
