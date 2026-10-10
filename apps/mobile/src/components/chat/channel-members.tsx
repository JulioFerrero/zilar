import { View } from 'react-native';

import { Avatar } from '@/components/chat/avatar';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import type { GroupRole } from '@/lib/chat-api';

/** A row in the channel member lists: the id, the shown name and the role. */
export type ChannelMember = {
  userId: string;
  name: string;
  role: GroupRole;
};

type ChannelMemberAction = {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
};

/**
 * One member row (T-0144), shared by the admins and subscribers lists. The
 * admins row keeps its role text and Demote button; the subscribers row shows
 * only the Promote button, so both keep their own text and only the shape is
 * shared.
 */
export function ChannelMemberRow({
  member,
  roleText,
  action,
  actionDisabled,
}: {
  member: ChannelMember;
  roleText?: string;
  action?: ChannelMemberAction;
  actionDisabled: boolean;
}) {
  return (
    <View className="mt-1 flex-row items-center gap-2 py-1.5">
      <Avatar id={member.userId} name={member.name} size={32} />
      <Text numberOfLines={1} className="min-w-0 flex-1 text-[14px] text-foreground">
        {member.name}
      </Text>
      {roleText !== undefined ? (
        <Text className="text-[11px] text-muted-foreground">{roleText}</Text>
      ) : null}
      {action !== undefined ? (
        <Button
          accessibilityLabel={action.accessibilityLabel}
          disabled={actionDisabled}
          onPress={action.onPress}
          variant="outline"
          size="sm"
        >
          <Text>{action.label}</Text>
        </Button>
      ) : null}
    </View>
  );
}

/**
 * The channel's member section (T-0144): managers see the subscribers below
 * the posters; subscribers see only the admins slice and its load error. The
 * owner promotes and demotes from here; a role change reads as a plain
 * message.
 */
export function ChannelMembers({
  isManager,
  isOwner,
  currentUserId,
  loading,
  admins,
  adminsLoadFailed,
  subscribers,
  roleBusy,
  roleError,
  onFlipRole,
}: {
  isManager: boolean;
  isOwner: boolean;
  currentUserId: string;
  loading: boolean;
  admins: ChannelMember[];
  adminsLoadFailed: boolean;
  subscribers: ChannelMember[];
  roleBusy: boolean;
  roleError: string;
  onFlipRole: (userId: string, role: 'admin' | 'member') => void;
}) {
  return (
    <>
      <Text className="mt-5 text-[13px] font-semibold text-muted-foreground">
        {isManager ? 'SUBSCRIBERS' : 'ADMINS'}
      </Text>
      {loading ? <Text className="mt-1 text-[13px] text-muted-foreground">Loading…</Text> : null}
      {!isManager && adminsLoadFailed ? (
        <Text role="alert" className="mt-1 text-[13px] text-danger">
          Could not load the admins. Try again.
        </Text>
      ) : null}
      {admins.map((member) => (
        <ChannelMemberRow
          key={member.userId}
          member={member}
          roleText={member.role}
          action={
            isOwner && member.userId !== currentUserId && member.role === 'admin'
              ? {
                  label: 'Demote',
                  accessibilityLabel: `Demote ${member.name} to subscriber`,
                  onPress: () => onFlipRole(member.userId, 'member'),
                }
              : undefined
          }
          actionDisabled={roleBusy}
        />
      ))}
      {subscribers.map((member) => (
        <ChannelMemberRow
          key={member.userId}
          member={member}
          action={
            isOwner && member.userId !== currentUserId
              ? {
                  label: 'Promote',
                  accessibilityLabel: `Promote ${member.name} to admin`,
                  onPress: () => onFlipRole(member.userId, 'admin'),
                }
              : undefined
          }
          actionDisabled={roleBusy}
        />
      ))}
      {roleError !== '' ? (
        <Text role="alert" className="mt-1 text-[13px] text-danger">
          {roleError}
        </Text>
      ) : null}
    </>
  );
}
