import { Plus } from 'lucide-react-native';

import { IconButton } from '@/components/ui/icon-button';
import { ScreenHeader } from '@/components/ui/screen-header';
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
    <ScreenHeader
      variant="sub"
      title="Connections"
      onBack={onBack}
      right={
        showAdd ? (
          <IconButton label="Add key" onPress={onAdd}>
            <Plus size={22} color={ICON} />
          </IconButton>
        ) : undefined
      }
    />
  );
}
