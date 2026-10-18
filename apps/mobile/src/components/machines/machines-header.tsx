import { Plus } from 'lucide-react-native';

import { IconButton } from '@/components/ui/icon-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { ICON } from '@/lib/colors';

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
