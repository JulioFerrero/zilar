import { ChevronLeft, Plus } from 'lucide-react-native';
import { View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';

/** The screen's top bar: Back and the Add key, with the large title under them. */
export function ConnectionsHeader({
  onBack,
  onAdd,
  showAdd,
}: {
  onBack: () => void;
  onAdd: () => void;
  showAdd: boolean;
}) {
  return (
    <View className="px-4 pt-2">
      <View className="h-14 flex-row items-center justify-between">
        <IconButton label="Back" onPress={onBack}>
          <ChevronLeft size={24} color={ICON} />
        </IconButton>
        {showAdd ? (
          <IconButton label="Add key" onPress={onAdd}>
            <Plus size={22} color={ICON} />
          </IconButton>
        ) : null}
      </View>
      <Text className="mt-1 mb-4 text-[28px] font-semibold leading-9 tracking-[-0.02em] text-foreground">
        Connections
      </Text>
    </View>
  );
}
