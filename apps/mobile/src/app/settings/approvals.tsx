import { useFocusEffect, useRouter } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { useColorScheme } from 'nativewind';

import { RequireAuth } from '@/auth/RequireAuth';
import { AisScreenShell } from '@/components/ais/screen-shell';
import { useApprovalsApi } from '@/components/chat/use-approvals-api';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { createAisApi } from '@/lib/ais-api';
import type { ApprovalDecision, ApprovalRule, PublicApproval } from '@/lib/approvals-api';
import { asColorScheme } from '@/lib/color-scheme';
import { ACCENT, MUTED_FOREGROUND } from '@/lib/colors';
import { getSessionToken } from '@/lib/session-token';

import { AlwaysAllowedRow, RevokeConfirmDialog } from '@/components/approvals/always-allowed-row';
import { PendingApprovalRow } from '@/components/approvals/approval-row';
import {
  confirmationForDecision,
  decideScreenRow,
  groupRulesForScreen,
  mergeRulesFanOut,
  orderedRows,
  revokeFailedOutcome,
  rowsForList,
  type OwnedScreenRule,
  type RowsById,
  type RowBusy,
} from '@/components/approvals/rows';

type LoadStatus = 'loading' | 'ready' | 'error';

/** A rule with the AI id re-attached: the rule route is per AI (`/ais/:id/…`) but the row carries none. */
export type OwnedRule = OwnedScreenRule;

const NOTICE_TIMEOUT_MS = 4000;

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
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  const [aiNames, setAiNames] = useState<Record<string, string>>({});
  const [ownedRules, setOwnedRules] = useState<OwnedRule[]>([]);
  const [rulesStatus, setRulesStatus] = useState<LoadStatus>('loading');
  const [rulesError, setRulesError] = useState('');
  const [confirmRule, setConfirmRule] = useState<OwnedRule | null>(null);
  const [revokingRule, setRevokingRule] = useState(false);
  const [revokeError, setRevokeError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const revokingRef = useRef(false);

  // The confirmation line after a decision ("Approved once", …) shows for a
  // few seconds where the row was, then clears itself.
  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current !== null) {
      clearTimeout(noticeTimer.current);
    }
    noticeTimer.current = setTimeout(() => {
      setNotice('');
      noticeTimer.current = null;
    }, NOTICE_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimer.current !== null) {
        clearTimeout(noticeTimer.current);
      }
    };
  }, []);

  const load = useCallback(
    async (showLoading: boolean) => {
      if (showLoading) {
        setStatus('loading');
      }
      try {
        const list = await api.listApprovals();
        const visible = list.filter((approval) => !decidedIds.current.has(approval.id));
        setRows((previous) => rowsForList(visible, previous));
        setStatus('ready');
        setErrorMessage('');
      } catch (error) {
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Could not load approvals.');
      } finally {
        setRefreshing(false);
      }
    },
    [api],
  );

  const loadRules = useCallback(
    async (pending: PublicApproval[]) => {
      setRulesStatus('loading');
      try {
        // One AI-list fetch for display names, then one rules fetch per AI
        // with a pending request (group rules are out of scope: T-0184).
        const ais = await createAisApi(getSessionToken)
          .listAis()
          .catch(() => []);
        const names: Record<string, string> = {};
        for (const ai of ais) {
          names[ai.id] = ai.name;
        }
        setAiNames(names);
        const aiIds = [...new Set(pending.map((approval) => approval.aiId))];
        // One AI's rules failure must not blank the others: each AI is
        // handled on its own (`mergeRulesFanOut` skips failures), and only
        // when every AI fails does the section show the error state.
        const settled = await Promise.allSettled(
          aiIds.map(async (aiId) => ({
            aiId,
            rules: await api.listAiApprovalRules(aiId),
          })),
        );
        const merged = mergeRulesFanOut(settled);
        if (merged === null) {
          const firstFailure = settled.find((result) => result.status === 'rejected');
          const reason =
            firstFailure !== undefined && firstFailure.status === 'rejected'
              ? firstFailure.reason
              : undefined;
          throw reason instanceof Error ? reason : new Error('Could not load the rules.');
        }
        setOwnedRules(merged);
        setRulesStatus('ready');
        setRulesError('');
      } catch (error) {
        setRulesStatus('error');
        setRulesError(error instanceof Error ? error.message : 'Could not load the rules.');
      }
    },
    [api],
  );

  // The first load.
  useEffect(() => {
    void load(true);
  }, [load]);

  // Refresh when the screen regains focus so coming back from a chat picks
  // up anything decided elsewhere.
  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  // Tick `now` every minute so the "expires in" countdown updates without a
  // full reload.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // The rules ride the pending rows' AI ids; reload them once pending loaded.
  const pendingList = useMemo(() => orderedRows(rows), [rows]);
  const pendingAiKey = useMemo(
    () => [...new Set(pendingList.map((row) => row.approval.aiId))].join(','),
    [pendingList],
  );
  useEffect(() => {
    if (status === 'ready') {
      void loadRules(pendingList.map((row) => row.approval));
    }
    // Runs when the pending AI set (or its readiness) changes, not on every
    // row render: `pendingList` is rebuilt per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAiKey, status]);

  const decide = useCallback(
    (id: string, decision: ApprovalDecision) => {
      setRows((previous) => {
        const current = previous[id];
        if (current === undefined) {
          return previous;
        }
        return { ...previous, [id]: { ...current, busy: decision, error: '' } };
      });
      void decideScreenRow(api, id, decision).then((outcome) => {
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
        } else {
          setRows((previous) => {
            const current = previous[id];
            if (current === undefined) {
              return previous;
            }
            return { ...previous, [id]: { ...current, busy: null, error: outcome.message } };
          });
        }
      });
    },
    [api, showNotice],
  );

  const askRevoke = useCallback((owned: OwnedRule) => {
    setRevokeError('');
    setConfirmRule(owned);
  }, []);

  // A ref like the AI list's `deletingRef`: it stops a second tap that lands
  // before the disabled state has propagated through React.
  const confirmRevoke = useCallback(() => {
    if (confirmRule === null || revokingRef.current) {
      return;
    }
    revokingRef.current = true;
    setRevokingRule(true);
    setRevokeError('');
    const id = confirmRule.rule.id;
    void api
      .revokeApprovalRule(id)
      .then(() => {
        setOwnedRules((previous) => previous.filter((owned) => owned.rule.id !== id));
        setConfirmRule(null);
      })
      .catch((error: unknown) => {
        const outcome = revokeFailedOutcome(error);
        if (outcome.dropped) {
          // Already gone (revoked elsewhere): drop the row quietly, like a
          // successful revoke.
          setOwnedRules((previous) => previous.filter((owned) => owned.rule.id !== id));
          setConfirmRule(null);
        } else {
          setRevokeError(outcome.message);
        }
      })
      .finally(() => {
        revokingRef.current = false;
        setRevokingRule(false);
      });
  }, [api, confirmRule]);

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

      {status === 'loading' ? (
        <View className="items-center gap-3 pt-16">
          <ActivityIndicator color={ACCENT[scheme]} />
          <Text className="text-[15px] text-muted-foreground">Loading…</Text>
        </View>
      ) : null}

      {status === 'error' ? (
        <View className="items-center gap-3 px-2 pt-12">
          <Text accessibilityRole="alert" className="text-center text-[15px] text-danger">
            {errorMessage}
          </Text>
          <Button variant="outline" onPress={() => void load(true)}>
            <Text>Retry</Text>
          </Button>
        </View>
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
                void load(false);
              }}
            />
          }
        >
          <PendingTab
            rows={pendingList}
            now={now}
            nameFor={nameFor}
            onDecide={decide}
            onRefresh={() => void load(false)}
          />

          <RulesSection
            status={rulesStatus}
            sections={ruleSections}
            error={rulesError}
            nameFor={nameFor}
            onAsk={askRevoke}
            onRetry={() => void loadRules(pendingList.map((row) => row.approval))}
          />
        </ScrollView>
      ) : null}

      <RevokeConfirmDialog
        rule={confirmRule?.rule ?? null}
        busy={revokingRule}
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
  onDecide: (id: string, decision: ApprovalDecision) => void;
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
        <PendingApprovalRow
          key={row.approval.id}
          approval={row.approval}
          aiName={nameFor(row.approval.aiId)}
          now={now}
          busy={row.busy}
          actionError={row.error}
          onDecide={onDecide}
        />
      ))}
    </View>
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
      {status === 'loading' ? (
        <Text role="status" className="text-[13px] text-muted-foreground">
          Loading…
        </Text>
      ) : null}
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
