import { Plus } from 'lucide-react-native';

import { IconButton } from '@/components/ui/icon-button';
import { ScreenHeader } from '@/components/ui/screen-header';
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
    <ScreenHeader
      variant="sub"
      title="Machines"
      onBack={onBack}
      right={
        showAdd ? (
          <IconButton label="Add machine" onPress={onAdd}>
            <Plus size={22} color={ICON} />
          </IconButton>
        ) : undefined
      }
    />
  );
}
