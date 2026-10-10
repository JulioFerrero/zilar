import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, SectionLabel } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { Machine } from '@/lib/machines-api';
import { MachineCard } from './machine-card';

/** Pending machines with the Approve / Deny buttons. */
export function PendingMachines({
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
    <View accessibilityLabel="Waiting for approval" className="gap-2">
      <SectionLabel>Waiting for approval</SectionLabel>
      <Card>
        {machines.map((machine) => (
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
                  onPress={() => onApprove(machine.id)}
                >
                  <Text>Approve</Text>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  accessibilityLabel={`Deny ${machine.name}`}
                  disabled={busyId === machine.id}
                  onPress={() => onDeny(machine.id)}
                >
                  <Text>Deny</Text>
                </Button>
              </>
            }
          />
        ))}
      </Card>
    </View>
  );
}
