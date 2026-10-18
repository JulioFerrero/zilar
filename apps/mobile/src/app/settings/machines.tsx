import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useRouter } from 'expo-router';
import { Server } from 'lucide-react-native';
import { useMemo } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { useAisApi } from '@/components/ais/use-ais-api';
import { AddMachineSheet } from '@/components/machines/add-machine-sheet';
import { ApprovedMachines } from '@/components/machines/approved-machines';
import { groupAisByMachine } from '@/components/machines/machine-row';
import { MachinesHeader } from '@/components/machines/machines-header';
import { PendingMachines } from '@/components/machines/pending-machines';
import { RevokedMachines } from '@/components/machines/revoked-machines';
import { useMachinesList } from '@/components/machines/use-machines-list';
import { usePullToRefresh } from '@/components/settings/screen-shell';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { useQuery } from '@/lib/effect/use-query';

/**
 * Settings → Machines (T-1526, the phone twin of web's `MachinesPage` T-1518):
 * the pending machines as amber cards with Deny / Approve, the other machines
 * as one rounded list whose rows open a sheet with Rename and Revoke, and a
 * Revoked row that toggles the old machines under the card. No status words.
 */
export default function MachinesScreen() {
  return (
    <RequireAuth>
      <MachinesList />
    </RequireAuth>
  );
}

function MachinesList() {
  const router = useRouter();
  const { api: aisApi } = useAisApi();
  const {
    status,
    errorInfo,
    machines,
    pending,
    approved,
    revoked,
    busyId,
    actionErrors,
    renamingId,
    renameDraft,
    showRevoked,
    adding,
    pairing,
    pairingLoading,
    pairingError,
    confirming,
    confirmError,
    setRenameDraft,
    reload,
    openAdd,
    closeAdd,
    retryAdd,
    approve,
    deny,
    openRename,
    saveRename,
    askRevoke,
    askDelete,
    confirmAction,
    cancelConfirm,
    cancelRename,
    toggleRevoked,
  } = useMachinesList();

  // The owner's AIs, loaded once for the row pictures and the sheet's names.
  // A failed read groups nothing, so the list simply shows no pictures.
  const [aiResult] = useQuery(() => Effect.promise(() => aisApi.listAis()), [aisApi]);
  const ais = AsyncResult.isSuccess(aiResult) ? aiResult.value : null;
  const aisByMachine = useMemo(() => groupAisByMachine(ais), [ais]);
  const { refreshing, pullToRefresh } = usePullToRefresh(reload);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <MachinesHeader onBack={() => router.back()} onAdd={openAdd} showAdd={status === 'ready'} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={MUTED_FOREGROUND}
            onRefresh={pullToRefresh}
          />
        }
      >
        <View className="gap-4 p-4">
          {status === 'ready' && errorInfo.message !== '' ? (
            <Text role="alert" className="text-[13px] text-danger">
              {errorInfo.message}
            </Text>
          ) : null}

          {status === 'loading' ? <StateMessage kind="loading" title="Loading machines…" /> : null}

          {status === 'error' ? (
            <StateMessage
              kind="error"
              title={errorInfo.message}
              action={{
                label: 'Retry',
                accessibilityLabel: 'Retry loading machines',
                onPress: reload,
              }}
            />
          ) : null}

          {status === 'ready' && machines.length === 0 ? (
            <StateMessage
              kind="empty"
              icon={Server}
              title="No machines yet. Add one to let your AIs work on your own computers."
              action={{
                label: 'Add machine',
                accessibilityLabel: 'Add a machine',
                onPress: openAdd,
              }}
            />
          ) : null}

          {status === 'ready' && pending.length > 0 ? (
            <PendingMachines
              machines={pending}
              busyId={busyId}
              actionErrors={actionErrors}
              onApprove={approve}
              onDeny={deny}
            />
          ) : null}

          {status === 'ready' && (approved.length > 0 || revoked.length > 0) ? (
            <ApprovedMachines
              machines={approved}
              aisByMachine={aisByMachine}
              busyId={busyId}
              actionErrors={actionErrors}
              renamingId={renamingId}
              renameDraft={renameDraft}
              onChangeRenameDraft={setRenameDraft}
              onCancelRename={cancelRename}
              onSaveRename={saveRename}
              onRename={openRename}
              onRevoke={askRevoke}
              revokedCount={revoked.length}
              showRevoked={showRevoked}
              onToggleRevoked={toggleRevoked}
            />
          ) : null}

          {status === 'ready' && showRevoked && revoked.length > 0 ? (
            <RevokedMachines
              machines={revoked}
              busyId={busyId}
              actionErrors={actionErrors}
              onDelete={askDelete}
            />
          ) : null}
        </View>
      </ScrollView>

      <AddMachineSheet
        visible={adding}
        pairing={pairing}
        loading={pairingLoading}
        error={pairingError}
        onRetry={retryAdd}
        onClose={closeAdd}
      />

      <ConfirmDialog
        visible={confirming !== null}
        title={confirming?.kind === 'revoke' ? 'Revoke this machine?' : 'Delete this machine?'}
        message={
          confirming?.kind === 'revoke'
            ? 'The machine loses access at once. AIs running there move back to the platform.'
            : 'This removes the machine for good. This cannot be undone.'
        }
        error={confirmError}
        confirmLabel={confirming?.kind === 'revoke' ? 'Revoke' : 'Delete'}
        busyLabel="Working…"
        busy={busyId !== null}
        onCancel={cancelConfirm}
        onConfirm={confirmAction}
        confirmAccessibilityLabel={
          confirming?.kind === 'revoke' ? 'Confirm revoke' : 'Confirm delete'
        }
      />
    </SafeAreaView>
  );
}
