import { ChevronLeft, Eye, Link2, Users } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';

type GroupHeaderProps = {
  title: string;
  /** The General topic's chat id: the avatar resolves through it. */
  avatarId: string;
  subtitle: string;
  canManageLinks: boolean;
  canChangeVisibility: boolean;
  onBack: () => void;
  /** Tapping the picture or the title opens the group info root (T-1552). */
  onOpenInfo: () => void;
  onOpenLinks: () => void;
  onOpenVisibility: () => void;
  onOpenRoles: () => void;
};

/** The group topics screen's top bar: back, the group avatar and title, and the three actions. */
export function GroupHeader({
  title,
  avatarId,
  subtitle,
  canManageLinks,
  canChangeVisibility,
  onBack,
  onOpenInfo,
  onOpenLinks,
  onOpenVisibility,
  onOpenRoles,
}: GroupHeaderProps) {
  return (
    <View className="flex-row items-center gap-1 border-b border-divider bg-surface px-1 py-1">
      <IconButton label="Back" onPress={onBack}>
        <ChevronLeft size={24} color={ICON} />
      </IconButton>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Group info"
        onPress={onOpenInfo}
        className="ml-1 min-w-0 flex-1 flex-row items-center gap-2.5 active:opacity-80"
      >
        <EntityAvatar chat={{ id: avatarId, title }} size={36} />
        <View className="min-w-0 flex-1 justify-center">
          <Text
            numberOfLines={1}
            className="shrink text-[15px] font-semibold leading-5 text-foreground"
          >
            {title}
          </Text>
          <Text numberOfLines={1} className="shrink text-[12px] leading-4 text-muted-foreground">
            {subtitle}
          </Text>
        </View>
      </Pressable>
      {canManageLinks ? (
        <IconButton label="Invite links" onPress={onOpenLinks}>
          <Link2 size={20} color={ICON} />
        </IconButton>
      ) : null}
      {canChangeVisibility ? (
        <IconButton label="Visibility" onPress={onOpenVisibility}>
          <Eye size={20} color={ICON} />
        </IconButton>
      ) : null}
      <IconButton label="Members and roles" onPress={onOpenRoles}>
        <Users size={22} color={ICON} />
      </IconButton>
    </View>
  );
}
