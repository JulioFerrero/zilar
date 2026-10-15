import { ChevronLeft, Plus } from 'lucide-react-native';
import { View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';

/**
 * The screen's top bar (T-1526): Back on the left, Add on the right and the
 * large title under them. There is no subtitle.
 */
export function MachinesHeader({
  onBack,
  onAdd,
  showAdd,
}: {
  onBack: () => void;
  onAdd: () => void;
  showAdd: boolean;
}) {
  return (
    <View className="px-4">
      <View className="-mx-2 flex-row items-center justify-between py-2">
        <IconButton label="Back" onPress={onBack}>
          <ChevronLeft size={24} color={ICON} />
        </IconButton>
        {showAdd ? (
          <IconButton label="Add machine" onPress={onAdd}>
            <Plus size={22} color={ICON} />
          </IconButton>
        ) : null}
      </View>
      <Text className="mb-4 mt-1 text-[28px] font-semibold leading-8 text-foreground">
        Machines
      </Text>
    </View>
  );
}
