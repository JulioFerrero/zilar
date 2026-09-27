import { protocolVersion } from '@galena/protocol';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { protocolLabel } from '@/lib/protocol';

export default function Index() {
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-background px-6">
      <Text variant="h1" className="text-4xl font-semibold tracking-tight">
        Galena
      </Text>
      <Text className="text-base text-muted-foreground">People and AIs, together.</Text>
      <Text className="text-xs text-muted-foreground">{protocolLabel(protocolVersion)}</Text>
    </View>
  );
}
