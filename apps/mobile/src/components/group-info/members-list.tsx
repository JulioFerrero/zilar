import { Crown, MoreVertical, Shield } from 'lucide-react-native';
import { View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { RoleChips } from '@/components/chat/role-chips';
import { InfoRowGroup } from '@/components/group-info/info-row';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import type { GroupMember } from '@/lib/chat-api';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { membersWithChips } from '@/lib/roles';
import type { CustomGroupRole } from '@/lib/roles-api';

/** The owner crown from the web `MemberRow` (`#e5b84b`); mobile has no token for it. */
const OWNER_COLOR = '#e5b84b';

type MembersListProps = {
  /** The members left after the search field's filter. */
  members: GroupMember[];
  /** The fresh custom roles, once loaded, so a member's chips stay right. */
  roles: CustomGroupRole[] | undefined;
  me: string | undefined;
  isManager: boolean;
  isOwner: boolean;
  /** A write is in flight, so the ⋮ keys wait. */
  busy: boolean;
  onOpenMenu: (member: GroupMember) => void;
};

/**
 * The member rows of Group info's People and AIs page (T-1569, moved out of
 * the page in T-1858): one rounded list of members, each with an avatar, name
 * and `@handle`, owner/admin as icons, role tags and a ⋮ key when the viewer
 * may remove them or hand over the group.
 */
export function MembersList({
  members,
  roles,
  me,
  isManager,
  isOwner,
  busy,
  onOpenMenu,
}: MembersListProps) {
  const chipsByUser = new Map(
    membersWithChips(members, roles).map((row) => [row.userId, row.chips]),
  );

  return (
    <InfoRowGroup>
      {members.map((member) => {
        const transferable = isOwner && member.userId !== me;
        const removable = isManager && member.role !== 'owner' && member.userId !== me;
        return (
          <View key={member.userId} className="min-h-[48px] flex-row items-center gap-3 px-3 py-2">
            <EntityAvatar person={member} size={40} />
            <View className="min-w-0 flex-1">
              <View className="min-w-0 flex-row items-center gap-1.5">
                <Text numberOfLines={1} className="shrink text-[15px] text-foreground">
                  {member.name}
                </Text>
                {member.handle === undefined ? null : (
                  <Text numberOfLines={1} className="shrink text-[13px] text-muted-foreground">
                    @{member.handle}
                  </Text>
                )}
                {member.role === 'owner' ? (
                  <View accessibilityRole="image" accessibilityLabel="Owner">
                    <Crown size={14} color={OWNER_COLOR} />
                  </View>
                ) : null}
                {member.role === 'admin' ? (
                  <View accessibilityRole="image" accessibilityLabel="Admin">
                    <Shield size={14} color={MUTED_FOREGROUND} />
                  </View>
                ) : null}
              </View>
              <RoleChips roles={chipsByUser.get(member.userId) ?? []} />
            </View>
            {transferable || removable ? (
              <IconButton
                label={`Options for ${member.name}`}
                className="h-9 w-9"
                disabled={busy}
                onPress={() => onOpenMenu(member)}
              >
                <MoreVertical size={16} color={ICON} />
              </IconButton>
            ) : null}
          </View>
        );
      })}
    </InfoRowGroup>
  );
}
