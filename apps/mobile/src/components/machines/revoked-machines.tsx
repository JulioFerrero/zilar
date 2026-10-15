import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { Machine } from '@/lib/machines-api';
import { MachineCard } from './machine-card';

/**
 * The revoked machines (T-1526), shown under the approved list when its
 * Revoked row is open. Each keeps today's Delete action.
 */
export function RevokedMachines({
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
