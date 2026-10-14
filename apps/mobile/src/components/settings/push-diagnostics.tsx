import { describeUserAgent, formatRelativeAudit } from '@zilar/chat-core';
import { View } from 'react-native';
import type { PushDevice } from '@zilar/api-contract';

import { Card, SectionLabel } from '@/components/ui/card';
import { Text } from '@/components/ui/text';

/** The native apps' user agents say nothing useful, so name them by kind. */
function deviceName(device: PushDevice): string {
  if (device.kind === 'fcm') {
    return 'Android app';
  }
  if (device.kind === 'apns') {
    return 'iPhone app';
  }
  return describeUserAgent(device.userAgent);
}

/**
 * The registered push devices (T-1356), mirroring the web `DevicesSection`:
 * name, last push or "No push yet", and the last failure with its reason. The
 * row of this phone is marked. No remove button: a phone unregisters on
 * sign-out (`native.ts`), and the web screen owns removal.
 */
export function PushDevicesSection({
  devices,
  thisDeviceId,
}: {
  devices: readonly PushDevice[];
  thisDeviceId: string | null;
}) {
  const now = new Date();
  return (
    <View className="gap-2">
      <SectionLabel>Devices</SectionLabel>
      {devices.length === 0 ? (
        <Text className="text-[14px] text-muted-foreground">No devices yet.</Text>
      ) : (
        <Card>
          {devices.map((device) => (
            <View key={device.id} className="px-3 py-2.5">
              <Text className="text-[15px] font-medium text-foreground">
                {deviceName(device)}
                {thisDeviceId !== null && device.id === thisDeviceId ? ' (this phone)' : ''}
              </Text>
              <Text className="mt-0.5 text-[13px] text-muted-foreground">
                {device.lastUsedAt !== null
                  ? `Last push: ${formatRelativeAudit(new Date(device.lastUsedAt), now)}`
                  : 'No push yet'}
                {device.inactive ? ' · inactive' : ''}
              </Text>
              {device.failedAt !== null ? (
                <Text className="mt-0.5 text-[13px] text-danger">
                  {`Failed ${formatRelativeAudit(new Date(device.failedAt), now)}: ${device.lastFailure ?? 'unknown'}`}
                </Text>
              ) : null}
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

/** One line: when this phone last woke for a push, or that it never has. */
export function LastPushReceivedLine({ at }: { at: string | null }) {
  const text =
    at === null
      ? 'Last push received on this phone: never'
      : `Last push received on this phone: ${formatRelativeAudit(new Date(at), new Date())}`;
  return <Text className="px-1 text-[13px] text-muted-foreground">{text}</Text>;
}
