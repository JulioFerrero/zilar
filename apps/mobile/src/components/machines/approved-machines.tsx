import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import type { PublicAi } from '@/lib/ais-api';
import type { Machine } from '@/lib/machines-api';
import { MachineRow, RevokedToggleRow } from './machine-row';
import { MachineSheet } from './machine-sheet';

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
