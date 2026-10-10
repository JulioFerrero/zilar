import { ChevronLeft, Plus } from 'lucide-react-native';
import { View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';

/** The screen's top bar: back, title and the Add button once the list is ready. */
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
    <View className="flex-row items-center gap-1 px-2 py-2">
      <IconButton label="Back" onPress={onBack}>
        <ChevronLeft size={24} color={ICON} />
      </IconButton>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[20px] font-semibold leading-6 text-foreground">
          Connections
        </Text>
        <Text numberOfLines={1} className="mt-0.5 text-[14px] leading-5 text-muted-foreground">
          Provider accounts for your AIs.
        </Text>
      </View>
      {showAdd ? (
        <IconButton label="Add a connection" onPress={onAdd}>
          <Plus size={22} color={ICON} />
        </IconButton>
      ) : null}
    </View>
  );
}
