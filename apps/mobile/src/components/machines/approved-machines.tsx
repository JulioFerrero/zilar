import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import type { PublicAi } from '@zilar/client-core';
import type { Machine } from '@/lib/machines-api';
import { MachineRow, RevokedToggleRow } from './machine-row';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { cn } from '@/lib/utils';

/** Groups the raw fingerprint in fours for display (`a1b2 c3d4 e5f6 0718`). */
function groupFingerprint(value: string): string {
  return value.replace(/(.{4})(?=.)/g, '$1 ');
}

function MachineSheet({
  machine,
  aiNames,
  visible,
  onClose,
  onRename,
  onRevoke,
}: {
  machine: Machine | null;
  aiNames: string[];
  visible: boolean;
  onClose: () => void;
  onRename: () => void;
  onRevoke: () => void;
}) {
  const online = machine?.online === true;
  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close machine actions"
      header={
        machine === null ? undefined : (
          <View className="gap-3 px-4 py-3.5">
            <View className="flex-row items-center gap-2.5">
              <View
                accessibilityRole="image"
                accessibilityLabel={online ? 'Online' : 'Offline'}
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  online ? 'bg-online' : 'bg-muted-foreground',
                )}
              />
              <Text
                numberOfLines={1}
                className="min-w-0 flex-1 text-[17px] font-semibold text-foreground"
              >
                {machine.name}
              </Text>
            </View>

            <Text className="text-[13px] text-muted-foreground">
              {machine.os} {machine.osVersion} · {machine.arch}
            </Text>

            <View className="h-11 items-center justify-center rounded-xl bg-well px-3">
              <Text
                numberOfLines={1}
                className="font-mono text-[15px] tracking-[0.08em] text-foreground"
              >
                {groupFingerprint(machine.fingerprint)}
              </Text>
            </View>

            {aiNames.length === 0 ? null : (
              <Text className="text-[13px] text-muted-foreground">{aiNames.join(', ')}</Text>
            )}
          </View>
        )
      }
    >
      <ActionSheetItem label="Rename" onPress={onRename} />
      <ActionSheetItem label="Revoke" destructive onPress={onRevoke} />
    </ActionSheet>
  );
}

export function ApprovedMachines({
  machines,
  aisByMachine,
  busyId,
  actionErrors,
  renamingId,
  renameDraft,
  onChangeRenameDraft,
  onCancelRename,
  onSaveRename,
  onRename,
  onRevoke,
  revokedCount,
  showRevoked,
  onToggleRevoked,
}: {
  machines: Machine[];
  aisByMachine: Map<string, PublicAi[]>;
  busyId: string | null;
  actionErrors: Record<string, string>;
  renamingId: string | null;
  renameDraft: string;
  onChangeRenameDraft: (name: string) => void;
  onCancelRename: () => void;
  onSaveRename: (id: string) => void;
  onRename: (machine: Machine) => void;
  onRevoke: (id: string) => void;
  revokedCount: number;
  showRevoked: boolean;
  onToggleRevoked: () => void;
}) {
  const [open, setOpen] = useState<Machine | null>(null);
  const openAis = open === null ? [] : (aisByMachine.get(open.id) ?? []);

  const closeSheet = (): void => {
    setOpen(null);
  };

  return (
    <>
      <Card>
        {machines.map((machine) =>
          renamingId === machine.id ? (
            <View key={machine.id} className="gap-2 px-4 py-3">
              <Text className="text-[14px] font-medium text-foreground">Rename</Text>
              <TextField
                value={renameDraft}
                onChangeText={onChangeRenameDraft}
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
                  onPress={onCancelRename}
                >
                  <Text>Cancel</Text>
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  accessibilityLabel="Save the new name"
                  disabled={busyId === machine.id}
                  onPress={() => onSaveRename(machine.id)}
                >
                  <Text>{busyId === machine.id ? 'Saving…' : 'Save'}</Text>
                </Button>
              </View>
            </View>
          ) : (
            <MachineRow
              key={machine.id}
              machine={machine}
              ai={aisByMachine.get(machine.id)?.[0]}
              onPress={() => setOpen(machine)}
            />
          ),
        )}

        {revokedCount > 0 ? (
          <RevokedToggleRow count={revokedCount} expanded={showRevoked} onPress={onToggleRevoked} />
        ) : null}
      </Card>

      <MachineSheet
        machine={open}
        aiNames={openAis.map((ai) => ai.name)}
        visible={open !== null}
        onClose={closeSheet}
        onRename={() => {
          if (open !== null) {
            onRename(open);
          }
          closeSheet();
        }}
        onRevoke={() => {
          if (open !== null) {
            onRevoke(open.id);
          }
          closeSheet();
        }}
      />
    </>
  );
}
