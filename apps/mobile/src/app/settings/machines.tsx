import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useRouter } from 'expo-router';
import { Server, Plus, Check, Copy } from 'lucide-react-native';
import { makeAisApi } from '@zilar/client-core';
import { groupFingerprint } from '@zilar/chat-core';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { RequireAuth } from '@/auth/RequireAuth';
import { useApi } from '@/lib/use-mockable-api';
import { ApprovedMachines } from '@/components/machines/approved-machines';
import { groupAisByMachine } from '@/components/machines/machine-row';
import { useMachinesList } from '@/components/machines/use-machines-list';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ICON, ACCENT_FOREGROUND } from '@/lib/colors';
import { useQuery } from '@/lib/effect/use-query';
import { IconButton } from '@/components/ui/icon-button';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { useAction } from '@/lib/effect/use-action';
import { MachineCallFailed } from '../../components/machines/mutations';
import type { Machine, PairingCode } from '@zilar/api-contract';

/**
 * The add flow, mirroring web's `AddMachineDialog`: the pairing code and the
 * `zilar-runner pair <CODE>` command. The parent mints the code, so this sheet
 * only renders it; the runner is unpublished, so the sheet says so.
 */
function AddMachineSheet({
  visible,
  pairing,
  loading,
  error,
  onRetry,
  onClose,
}: {
  visible: boolean;
  pairing: PairingCode | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [, copyCode] = useAction((code: string) =>
    Effect.tryPromise({
      try: () => Clipboard.setStringAsync(code),
      catch: () => new MachineCallFailed({ message: 'Could not copy the code.' }),
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          setCopied(true);
        }),
      ),
    ),
  );

  const copy = (): void => {
    if (pairing === null) {
      return;
    }
    copyCode(pairing.code);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close add machine"
      title="Add machine"
      footer={
        !loading && error !== '' ? (
          <Button accessibilityLabel="Try again" onPress={onRetry}>
            <Text>Try again</Text>
          </Button>
        ) : undefined
      }
    >
      <Text className="mt-1 text-[14px] leading-5 text-muted-foreground">
        Pair a new computer where your AIs can work.
      </Text>

      {loading ? <StateMessage kind="loading" title="Creating code…" /> : null}

      {!loading && error !== '' ? (
        <Text accessibilityRole="alert" className="mt-3 text-[14px] text-danger">
          {error}
        </Text>
      ) : null}

      {!loading && error === '' && pairing !== null ? (
        <>
          <View className="mt-3 rounded-xl border border-divider bg-surface px-4 py-3">
            <Text
              selectable
              className="text-center font-mono text-[24px] font-semibold tracking-[0.1em] text-foreground"
            >
              {pairing.code}
            </Text>
            <View className="mt-2 flex-row items-center justify-center">
              <Button
                variant="default"
                size="sm"
                accessibilityLabel="Copy pairing code"
                onPress={copy}
              >
                {copied ? (
                  <Check size={14} color={ACCENT_FOREGROUND} />
                ) : (
                  <Copy size={14} color={ACCENT_FOREGROUND} />
                )}
                <Text>{copied ? 'Copied' : 'Copy'}</Text>
              </Button>
            </View>
          </View>
          <Text className="mt-3 text-[14px] leading-5 text-foreground">
            On the machine, download the runner app, then run{' '}
            <Text className="font-mono text-[13px]">zilar-runner pair {pairing.code}</Text>
          </Text>
          <Text className="mt-1 text-[13px] text-muted-foreground">
            The desktop runner is not published yet — this code is ready for when it is.
          </Text>
        </>
      ) : null}
    </BottomSheet>
  );
}

function PendingMachines({
  machines,
  busyId,
  actionErrors,
  onApprove,
  onDeny,
}: {
  machines: Machine[];
  busyId: string | null;
  actionErrors: Record<string, string>;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  return (
    <View accessibilityLabel="Waiting for approval" className="gap-4">
      {machines.map((machine) => {
        const busy = busyId === machine.id;
        const error = actionErrors[machine.id] ?? '';
        return (
          <View
            key={machine.id}
            className="gap-3.5 rounded-2xl border border-border bg-surface p-4"
          >
            <View className="flex-row items-center gap-2.5">
              <View
                accessibilityRole="image"
                accessibilityLabel="Waiting"
                className="h-2 w-2 shrink-0 rounded-full bg-[#f59e0b]"
              />
              <Text numberOfLines={1} className="text-[15px] font-semibold text-foreground">
                {machine.name}
              </Text>
            </View>

            <View className="h-11 items-center justify-center rounded-xl bg-well px-3">
              <Text
                numberOfLines={1}
                className="font-mono text-[15px] tracking-[0.08em] text-foreground"
              >
                {groupFingerprint(machine.fingerprint)}
              </Text>
            </View>

            <Text className="text-[13px] text-muted-foreground">
              Approve if the machine shows this code.
            </Text>

            <View className="flex-row gap-2" pointerEvents={busy ? 'none' : 'auto'}>
              <Button
                variant="outline"
                className="h-11 flex-1"
                accessibilityLabel={`Deny ${machine.name}`}
                disabled={busy}
                onPress={() => onDeny(machine.id)}
              >
                <Text>Deny</Text>
              </Button>
              <Button
                variant="default"
                className="h-11 flex-1"
                accessibilityLabel={`Approve ${machine.name}`}
                disabled={busy}
                onPress={() => onApprove(machine.id)}
              >
                <Text>Approve</Text>
              </Button>
            </View>

            {error !== '' ? (
              <Text accessibilityRole="alert" className="text-[13px] text-danger">
                {error}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function MachineCard({
  machine,
  busy,
  error,
  actions,
}: {
  machine: Machine;
  busy: boolean;
  error: string;
  actions: React.ReactNode;
}) {
  return (
    <View className="gap-1 px-3 py-2.5">
      <View className="flex-row items-center gap-3">
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
            {machine.name}
          </Text>
          <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
            {machine.os} {machine.osVersion} · {machine.arch}
          </Text>
        </View>
        <View className="flex-row shrink-0 gap-2" pointerEvents={busy ? 'none' : 'auto'}>
          {actions}
        </View>
      </View>
      {error !== '' ? (
        <Text accessibilityRole="alert" className="text-[13px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function RevokedMachines({
  machines,
  busyId,
  actionErrors,
  onDelete,
}: {
  machines: Machine[];
  busyId: string | null;
  actionErrors: Record<string, string>;
  onDelete: (id: string) => void;
}) {
  return (
    <View accessibilityLabel="Revoked machines">
      <Card>
        {machines.map((machine) => (
          <MachineCard
            key={machine.id}
            machine={machine}
            busy={busyId === machine.id}
            error={actionErrors[machine.id] ?? ''}
            actions={
              <Button
                variant="outline"
                size="sm"
                accessibilityLabel={`Delete ${machine.name}`}
                disabled={busyId === machine.id}
                onPress={() => onDelete(machine.id)}
              >
                <Text>Delete</Text>
              </Button>
            }
          />
        ))}
      </Card>
    </View>
  );
}

export default function MachinesScreen() {
  return (
    <RequireAuth>
      <MachinesList />
    </RequireAuth>
  );
}

function MachinesList() {
  const router = useRouter();
  const { api: aisApi } = useApi(makeAisApi);
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

  const [aiResult] = useQuery(() => Effect.promise(() => aisApi.listAis()), [aisApi]);
  const ais = AsyncResult.isSuccess(aiResult) ? aiResult.value : null;
  const aisByMachine = useMemo(() => groupAisByMachine(ais), [ais]);

  return (
    <SettingsScreenShell
      title="Machines"
      onBack={() => router.back()}
      right={
        status === 'ready' ? (
          <IconButton label="Add machine" onPress={openAdd}>
            <Plus size={22} color={ICON} />
          </IconButton>
        ) : undefined
      }
      onRefresh={reload}
      keyboardAvoidance={false}
      contentClassName="gap-4 p-4"
      contentPaddingBottom={32}
      after={
        <>
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
        </>
      }
    >
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
    </SettingsScreenShell>
  );
}
