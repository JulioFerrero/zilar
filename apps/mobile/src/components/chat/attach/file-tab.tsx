import { FileText } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { AttachmentChoice } from '@/components/chat/attach-sheet';
import { ICON } from '@/lib/colors';

/**
 * The File tab (T-1320): today's document picker behind "Browse files". The
 * Telegram row "Send photos as files" is deliberately absent: the send path
 * takes the kind from the file's MIME (`classifyMobileFile` /
 * `attachmentDataFor`), so a photo cannot be forced to `kind: 'file'` without
 * changing the store's bytes port (`apps/mobile/src/store/effects/ports.ts`).
 */
export function FileTab({
  busy,
  onPick,
}: {
  busy: boolean;
  onPick: (choice: AttachmentChoice) => void;
}) {
  const iconColor = ICON;
  return (
    <View className="pt-1">
      <FileRow
        label="Browse files"
        hint="Any document"
        onPress={() => onPick('file')}
        busy={busy}
        icon={<FileText size={20} color={iconColor} />}
      />
    </View>
  );
}

function FileRow({
  label,
  hint,
  onPress,
  busy,
  icon,
}: {
  label: string;
  hint: string;
  onPress: () => void;
  busy: boolean;
  icon: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      className="flex-row items-center gap-3 border-b border-divider px-1 py-3.5 active:bg-surface-raised disabled:opacity-60"
    >
      <View className="h-9 w-9 items-center justify-center rounded-[8px] bg-surface-raised">
        {icon}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[16px] text-foreground">{label}</Text>
        <Text className="text-[13px] text-muted-foreground">{hint}</Text>
      </View>
    </Pressable>
  );
}
