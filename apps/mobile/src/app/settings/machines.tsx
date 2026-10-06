import { useFocusEffect, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Copy,
  Plus,
  Server,
} from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';

import { RequireAuth } from '@/auth/RequireAuth';
import { Button } from '@/components/ui/button';
import { Card, SectionLabel } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { asColorScheme } from '@/lib/color-scheme';
import { ACCENT_FOREGROUND, ICON } from '@/lib/colors';
import type { Machine, PairingCode } from '@/lib/machines-api';
import { describeMachinesError, type MachinesErrorInfo } from '@/components/machines/errors';
import { useMachinesApi } from '@/components/machines/use-machines-api';

type PageStatus = 'loading' | 'ready' | 'error';

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
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const { api } = useMachinesApi();

  const [machines, setMachines] = useState<Machine[]>([]);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [errorInfo, setErrorInfo] = useState<MachinesErrorInfo>({ message: '' });
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  // Guards against a double tap landing before React re-renders the disabled
  // button, so one confirm can never send two requests.
  const busyRef = useRef(false);
  const [confirming, setConfirming] = useState<{ kind: 'revoke' | 'delete'; id: string } | null>(
    null,
  );
  const [confirmError, setConfirmError] = useState('');
  // The add flow state lives in the parent: the "Add machine" tap mints
  // the code directly (an event, not an effect), and the sheet only renders
  // the result. `addToken` guards a late answer after the sheet closed.
  // `addBusyRef` stops a double tap minting two pairing codes (10 per hour).
  const [adding, setAdding] = useState(false);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState('');
  const addToken = useRef(0);
  const addBusyRef = useRef(false);

  const openAdd = useCallback(() => {
    if (addBusyRef.current) {
      return;
    }
    addBusyRef.current = true;
    addToken.current += 1;
    const token = addToken.current;
    setAdding(true);
    setPairingLoading(true);
    setPairingError('');
    setPairing(null);
    void api
      .createPairingCode()
      .then((next) => {
        if (addToken.current === token) {
          setPairing(next);
        }
      })
      .catch((cause: unknown) => {
        if (addToken.current === token) {
          setPairingError(describeMachinesError(cause, 'Could not create a pairing code.').message);
        }
      })
      .finally(() => {
        addBusyRef.current = false;
        if (addToken.current === token) {
          setPairingLoading(false);
        }
      });
  }, [api]);

  const closeAdd = useCallback(() => {
    addToken.current += 1;
    setAdding(false);
  }, []);

  const retryAdd = useCallback(() => {
    closeAdd();
    openAdd();
  }, [closeAdd, openAdd]);
  const [showRevoked, setShowRevoked] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const reload = useCallback(() => {
    setStatus('loading');
    setActionErrors({});
    void api
      .listMachines()
      .then((list) => {
        setMachines(list);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        setErrorInfo(describeMachinesError(error, 'Could not load your machines.'));
        setStatus('error');
      });
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const setRowError = (id: string, message: string): void => {
    setActionErrors((previous) => ({ ...previous, [id]: message }));
  };

  const clearRowError = (id: string): void => {
    setActionErrors((previous) => {
      if (!(id in previous)) {
        return previous;
      }
      const { [id]: _removed, ...rest } = previous;
      void _removed;
      return rest;
    });
  };

  const run = (id: string, task: () => Promise<void>, fallback: string): void => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusyId(id);
    clearRowError(id);
    void task()
      .catch((error: unknown) => {
        setRowError(id, describeMachinesError(error, fallback).message);
      })
      .finally(() => {
        busyRef.current = false;
        setBusyId(null);
      });
  };

  const approve = (id: string): void => {
    run(
      id,
      () =>
        api.approveMachine(id).then((updated) => {
          setMachines((previous) => previous.map((m) => (m.id === id ? updated : m)));
        }),
      'Could not approve the machine.',
    );
  };

  const deny = (id: string): void => {
    run(
      id,
      () =>
        api.denyMachine(id).then(() => {
          setMachines((previous) => previous.filter((m) => m.id !== id));
        }),
      'Could not deny the machine.',
    );
  };

  const openRename = (machine: Machine): void => {
    setRenamingId(machine.id);
    setRenameDraft(machine.name);
    clearRowError(machine.id);
  };

  const saveRename = (id: string): void => {
    const name = renameDraft.trim();
    if (name === '') {
      setRowError(id, 'Give the machine a name.');
      return;
    }
    run(
      id,
      () =>
        api.renameMachine(id, name).then((updated) => {
          setMachines((previous) => previous.map((m) => (m.id === id ? updated : m)));
          setRenamingId(null);
        }),
      'Could not rename the machine.',
    );
  };

  const askConfirm = (kind: 'revoke' | 'delete', id: string): void => {
    setConfirming({ kind, id });
    setConfirmError('');
  };

  const confirmAction = (): void => {
    if (confirming === null || busyRef.current) {
      return;
    }
    const { kind, id } = confirming;
    busyRef.current = true;
    setBusyId(id);
    setConfirmError('');
    const task =
      kind === 'revoke'
        ? api.revokeMachine(id).then((updated) => {
            setMachines((previous) => previous.map((m) => (m.id === id ? updated : m)));
          })
        : api.deleteMachine(id).then(() => {
            setMachines((previous) => previous.filter((m) => m.id !== id));
          });
    void task
      .then(() => setConfirming(null))
      .catch((error: unknown) => {
        setConfirmError(
          describeMachinesError(
            error,
            kind === 'revoke' ? 'Could not revoke the machine.' : 'Could not delete the machine.',
          ).message,
        );
      })
      .finally(() => {
        busyRef.current = false;
        setBusyId(null);
      });
  };

  const pending = machines.filter((m) => m.status === 'pending');
  const approved = machines.filter((m) => m.status === 'approved');
  const revoked = machines.filter((m) => m.status === 'revoked');

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center gap-1 px-2 py-2">
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={24} color={ICON[scheme]} />
        </IconButton>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[20px] font-semibold leading-6 text-foreground">
            Machines
          </Text>
          <Text numberOfLines={1} className="mt-0.5 text-[14px] leading-5 text-muted-foreground">
            Computers where your AIs can work.
          </Text>
        </View>
        {status === 'ready' ? (
          <IconButton label="Add machine" onPress={openAdd}>
            <Plus size={22} color={ICON[scheme]} />
          </IconButton>
        ) : null}
      </View>

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
            <View accessibilityLabel="Waiting for approval" className="gap-2">
              <SectionLabel>Waiting for approval</SectionLabel>
              <Card>
                {pending.map((machine) => (
                  <MachineCard
                    key={machine.id}
                    machine={machine}
                    busy={busyId === machine.id}
                    error={actionErrors[machine.id] ?? ''}
                    actions={
                      <>
                        <Button
                          variant="default"
                          size="sm"
                          accessibilityLabel={`Approve ${machine.name}`}
                          disabled={busyId === machine.id}
                          onPress={() => approve(machine.id)}
                        >
                          <Text>Approve</Text>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          accessibilityLabel={`Deny ${machine.name}`}
                          disabled={busyId === machine.id}
                          onPress={() => deny(machine.id)}
                        >
                          <Text>Deny</Text>
                        </Button>
                      </>
                    }
                  />
                ))}
              </Card>
            </View>
          ) : null}

          {status === 'ready' && approved.length > 0 ? (
            <View accessibilityLabel="Your machines" className="gap-2">
              <SectionLabel>Your machines</SectionLabel>
              <Card>
                {approved.map((machine) =>
                  renamingId === machine.id ? (
                    <View key={machine.id} className="gap-2 px-3 py-2.5">
                      <Text className="text-[14px] font-medium text-foreground">Rename</Text>
                      <TextField
                        value={renameDraft}
                        onChangeText={setRenameDraft}
                        accessibilityLabel={`Name for ${machine.name}`}
                        maxLength={64}
                        autoFocus
                      />
                      {actionErrors[machine.id] !== undefined && actionErrors[machine.id] !== '' ? (
                        <Text accessibilityRole="alert" className="text-[13px] text-danger">
                          {actionErrors[machine.id]}
                        </Text>
                      ) : null}
                      <View className="flex-row justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          accessibilityLabel="Cancel renaming"
                          disabled={busyId === machine.id}
                          onPress={() => setRenamingId(null)}
                        >
                          <Text>Cancel</Text>
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          accessibilityLabel="Save the new name"
                          disabled={busyId === machine.id}
                          onPress={() => saveRename(machine.id)}
                        >
                          <Text>{busyId === machine.id ? 'Saving…' : 'Save'}</Text>
                        </Button>
                      </View>
                    </View>
                  ) : (
                    <MachineCard
                      key={machine.id}
                      machine={machine}
                      busy={busyId === machine.id}
                      error={actionErrors[machine.id] ?? ''}
                      actions={
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            accessibilityLabel={`Rename ${machine.name}`}
                            disabled={busyId === machine.id}
                            onPress={() => openRename(machine)}
                          >
                            <Text>Rename</Text>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            accessibilityLabel={`Revoke ${machine.name}`}
                            disabled={busyId === machine.id}
                            onPress={() => askConfirm('revoke', machine.id)}
                          >
                            <Text>Revoke</Text>
                          </Button>
                        </>
                      }
                    />
                  ),
                )}
              </Card>
            </View>
          ) : null}

          {status === 'ready' && revoked.length > 0 ? (
            <View accessibilityLabel="Revoked machines" className="gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="self-start gap-1 px-0"
                accessibilityLabel={showRevoked ? 'Hide revoked machines' : 'Show revoked machines'}
                accessibilityState={{ expanded: showRevoked }}
                onPress={() => setShowRevoked((value) => !value)}
              >
                {showRevoked ? (
                  <ChevronUp size={16} color={ICON[scheme]} />
                ) : (
                  <ChevronDown size={16} color={ICON[scheme]} />
                )}
                <Text className="text-[15px] font-semibold text-foreground">
                  Revoked ({revoked.length})
                </Text>
              </Button>
              {showRevoked ? (
                <Card>
                  {revoked.map((machine) => (
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
                          onPress={() => askConfirm('delete', machine.id)}
                        >
                          <Text>Delete</Text>
                        </Button>
                      }
                    />
                  ))}
                </Card>
              ) : null}
            </View>
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
        onCancel={() => setConfirming(null)}
        onConfirm={confirmAction}
        confirmAccessibilityLabel={
          confirming?.kind === 'revoke' ? 'Confirm revoke' : 'Confirm delete'
        }
      />
    </SafeAreaView>
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

/**
 * The add flow (mirrors web's `AddMachineDialog`): shows the pairing code
 * big with a Copy button and the `zilar-runner pair <CODE>` command. The
 * code is minted by the parent's "Add machine" tap, so this sheet is pure
 * render. The desktop runner is not published yet, so the sheet says so
 * honestly, exactly like web.
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
  const scheme = asColorScheme(useColorScheme().colorScheme);

  const copy = (): void => {
    if (pairing === null) {
      return;
    }
    const code = pairing.code;
    void Clipboard.setStringAsync(code).then(() => {
      setCopied(true);
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 p-6">
        <View className="w-full max-w-xs rounded-2xl border border-border-strong bg-surface p-4">
          <Text className="text-[16px] font-semibold text-foreground">Add machine</Text>
          <Text className="mt-1 text-[14px] leading-5 text-muted-foreground">
            Pair a new computer where your AIs can work.
          </Text>

          {loading ? <StateMessage kind="loading" title="Creating code…" /> : null}

          {!loading && error !== '' ? (
            <>
              <Text accessibilityRole="alert" className="mt-3 text-[14px] text-danger">
                {error}
              </Text>
              <View className="mt-4 flex-row justify-end gap-2">
                <Button variant="ghost" size="sm" accessibilityLabel="Close" onPress={onClose}>
                  <Text>Close</Text>
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  accessibilityLabel="Try again"
                  onPress={onRetry}
                >
                  <Text>Try again</Text>
                </Button>
              </View>
            </>
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
                      <Check size={14} color={ACCENT_FOREGROUND[scheme]} />
                    ) : (
                      <Copy size={14} color={ACCENT_FOREGROUND[scheme]} />
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
              <View className="mt-4 flex-row justify-end">
                <Button variant="default" size="sm" accessibilityLabel="Done" onPress={onClose}>
                  <Text>Done</Text>
                </Button>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
