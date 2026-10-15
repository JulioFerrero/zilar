import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import type { Machine } from '@/lib/machines-api';

/** Groups the raw fingerprint in fours for display (`a1b2 c3d4 e5f6 0718`). */
function groupFingerprint(value: string): string {
  return value.replace(/(.{4})(?=.)/g, '$1 ');
}

/**
 * The pending machines (T-1526): a card per machine with the amber waiting dot,
 * the fingerprint in a mono well and Deny / Approve sharing the width. No
 * status word: the dot is the status.
 */
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
