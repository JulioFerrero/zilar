import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { useClientVersionCheck } from '@/lib/use-client-version';

/**
 * A thin bar at the top when this build is older than the server's minimum
 * client protocol (OPS-21). It sits in the layout flow (it pushes content down
 * rather than covering it), never blocks use, and renders nothing at the
 * current version.
 */
export function ClientVersionBanner() {
  const outdated = useClientVersionCheck();
  const insets = useSafeAreaInsets();

  if (!outdated) {
    return null;
  }

  return (
    <View style={{ paddingTop: insets.top }} className="border-b border-divider bg-accent">
      <Text
        accessibilityRole="alert"
        className="px-3 py-2 text-center text-[13px] text-accent-foreground"
      >
        Please update the app to keep chatting.
      </Text>
    </View>
  );
}
