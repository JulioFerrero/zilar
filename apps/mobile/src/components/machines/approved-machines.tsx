import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, SectionLabel } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import type { Machine } from '@/lib/machines-api';
import { MachineCard } from './machine-card';

/** Approved machines with Rename (inline editor) and Revoke. */
export function ApprovedMachines({
  machines,
  busyId,
  actionErrors,
  renamingId,
  renameDraft,
  onChangeRenameDraft,
  onCancelRename,
  onSaveRename,
  onRename,
  onRevoke,
}: {
  machines: Machine[];
  busyId: string | null;
  actionErrors: Record<string, string>;
  renamingId: string | null;
  renameDraft: string;
  onChangeRenameDraft: (name: string) => void;
  onCancelRename: () => void;
  onSaveRename: (id: string) => void;
  onRename: (machine: Machine) => void;
  onRevoke: (id: string) => void;
}) {
  return (
    <View accessibilityLabel="Your machines" className="gap-2">
      <SectionLabel>Your machines</SectionLabel>
      <Card>
        {machines.map((machine) =>
          renamingId === machine.id ? (
            <View key={machine.id} className="gap-2 px-3 py-2.5">
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
                    onPress={() => onRename(machine)}
                  >
                    <Text>Rename</Text>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    accessibilityLabel={`Revoke ${machine.name}`}
                    disabled={busyId === machine.id}
                    onPress={() => onRevoke(machine.id)}
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
  );
}
