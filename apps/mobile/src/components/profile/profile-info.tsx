import { Copy } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';

type ProfileInfoProps = {
  handle: string;
  bio?: string | undefined;
  onCopyUsername: () => void;
};

/**
 * The profile info card (T-1308): the grouped list with the @handle (tap to
 * copy, the app's toast confirms it) and the bio when the person wrote one.
 */
export function ProfileInfo({ handle, bio, onCopyUsername }: ProfileInfoProps) {
  return (
    <View className="gap-0 overflow-hidden rounded-xl border border-border bg-surface">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Copy username"
        onPress={onCopyUsername}
        className="flex-row items-center justify-between px-3 py-2.5 active:bg-surface-raised"
      >
        <View className="min-w-0 flex-1">
          <Text className="text-[13px]" style={{ color: MUTED_FOREGROUND }}>
            Username
          </Text>
          <Text numberOfLines={1} className="mt-0.5 text-[15px] text-foreground">
            @{handle}
          </Text>
        </View>
        <Copy size={18} color={MUTED_FOREGROUND} />
      </Pressable>
      {bio === undefined || bio === '' ? null : (
        <View className="border-t border-divider px-3 py-2.5">
          <Text className="text-[13px]" style={{ color: MUTED_FOREGROUND }}>
            Bio
          </Text>
          <Text className="mt-0.5 text-[15px] leading-5 text-foreground">{bio}</Text>
        </View>
      )}
    </View>
  );
}
