import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import type { Machine } from '@/lib/machines-api';
import { MachineCard } from './machine-card';

/** Revoked machines behind a collapsible header, each with Delete. */
export function RevokedMachines({
  machines,
  busyId,
  actionErrors,
  showRevoked,
  onToggle,
  onDelete,
}: {
  machines: Machine[];
  busyId: string | null;
  actionErrors: Record<string, string>;
  showRevoked: boolean;
  onToggle: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <View accessibilityLabel="Revoked machines" className="gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="self-start gap-1 px-0"
        accessibilityLabel={showRevoked ? 'Hide revoked machines' : 'Show revoked machines'}
        accessibilityState={{ expanded: showRevoked }}
        onPress={onToggle}
      >
        {showRevoked ? (
          <ChevronUp size={16} color={ICON} />
        ) : (
          <ChevronDown size={16} color={ICON} />
        )}
        <Text className="text-[15px] font-semibold text-foreground">
          Revoked ({machines.length})
        </Text>
      </Button>
      {showRevoked ? (
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
      ) : null}
    </View>
  );
}
