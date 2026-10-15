import { Globe, Lock } from 'lucide-react-native';
import { View } from 'react-native';

import { SegmentedControl } from '@/components/ui/segmented-control';
import { Text } from '@/components/ui/text';

import type { PackVisibility } from './use-pack-editor';

/** The pack's `Private` / `Shared` choice, a segmented switch. */
export function PackVisibilityField({
  value,
  disabled,
  imported,
  onChange,
}: {
  value: PackVisibility;
  disabled: boolean;
  imported: boolean;
  onChange: (next: PackVisibility) => void;
}) {
  return (
    <View className="gap-2">
      <SegmentedControl
        mode="radio"
        accessibilityLabel="Who can find this pack"
        options={[
          { value: 'private', label: 'Private', icon: Lock, disabled },
          { value: 'server', label: 'Shared', icon: Globe, disabled },
        ]}
        value={value}
        onChange={(next) => onChange(next === 'server' ? 'server' : 'private')}
      />
      {imported ? (
        <Text className="text-[13px] text-muted-foreground">
          Imported packs are for personal use, so they stay private and cannot be shared.
        </Text>
      ) : null}
    </View>
  );
}
