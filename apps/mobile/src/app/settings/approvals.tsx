import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { AisScreenShell } from '@/components/ais/screen-shell';
import { RevokeConfirmDialog } from '@/components/approvals/always-allowed-row';
import { PendingTab } from '@/components/approvals/pending-tab';
import { RulesSection } from '@/components/approvals/rules-section';
import { useApprovals } from '@/components/approvals/use-approvals';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { isWaiting } from '@/lib/effect/use-action';

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
