import { useRouter } from 'expo-router';
import { Server } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { AddMachineSheet } from '@/components/machines/add-machine-sheet';
import { ApprovedMachines } from '@/components/machines/approved-machines';
import { MachinesHeader } from '@/components/machines/machines-header';
import { PendingMachines } from '@/components/machines/pending-machines';
import { RevokedMachines } from '@/components/machines/revoked-machines';
import { useMachinesList } from '@/components/machines/use-machines-list';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StateMessage } from '@/components/ui/state-message';

/**
 * Settings → Machines (mirrors web's `MachinesPage`): pending machines with
 * Approve / Deny, approved with Rename / Revoke, revoked with Delete, plus
 * the add flow showing the pairing code and command with Copy. Web's
 * `SettingsShell` has no mobile twin, so the screen uses the same frame as
 * the settings requests screen.
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

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <MachinesHeader onBack={() => router.back()} onAdd={openAdd} showAdd={status === 'ready'} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-4 p-4">
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

          {status === 'ready' && approved.length > 0 ? (
            <ApprovedMachines
              machines={approved}
              busyId={busyId}
              actionErrors={actionErrors}
              renamingId={renamingId}
              renameDraft={renameDraft}
              onChangeRenameDraft={setRenameDraft}
              onCancelRename={cancelRename}
              onSaveRename={saveRename}
              onRename={openRename}
              onRevoke={askRevoke}
            />
          ) : null}

          {status === 'ready' && revoked.length > 0 ? (
            <RevokedMachines
              machines={revoked}
              busyId={busyId}
              actionErrors={actionErrors}
              showRevoked={showRevoked}
              onToggle={toggleRevoked}
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
