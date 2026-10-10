import { ChevronLeft, Eye, Link2, Users } from 'lucide-react-native';
import { View } from 'react-native';

import { Avatar } from '@/components/chat/avatar';
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
  onOpenLinks,
  onOpenVisibility,
  onOpenRoles,
}: GroupHeaderProps) {
  return (
    <View className="flex-row items-center gap-1 border-b border-divider bg-surface px-1 py-1">
      <IconButton label="Back" onPress={onBack}>
        <ChevronLeft size={24} color={ICON} />
      </IconButton>
      <Avatar id={avatarId} name={title} size={36} />
      <View className="ml-2.5 min-w-0 flex-1">
        <Text numberOfLines={1} className="shrink text-[15px] font-semibold text-foreground">
          {title}
        </Text>
        <Text numberOfLines={1} className="shrink text-[12px] text-muted-foreground">
          {subtitle}
        </Text>
      </View>
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
