import type { LucideIcon } from 'lucide-react-native';
import {
  Bell,
  BellOff,
  Check,
  Inbox,
  MessageCircle,
  Search,
  UserPlus,
  X,
} from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import type { ProfilePerson } from '@/components/profile/profile-person';
import { Text } from '@/components/ui/text';
import { ACCENT_FOREGROUND, ICON } from '@/lib/colors';
import { cn } from '@/lib/utils';

export type ProfileAction = {
  /** A stable key for the list. */
  key: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
  /** The primary action (Send request / Accept), drawn on the accent. */
  primary?: boolean;
};

function ProfileActionButton({ action }: { action: ProfileAction }) {
  const Icon = action.icon;
  const disabled = action.disabled === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={action.onPress}
      className={cn('min-w-[68px] items-center gap-2 active:opacity-80', disabled && 'opacity-50')}
    >
      <View
        className={cn(
          'h-12 w-12 items-center justify-center rounded-full',
          action.primary === true ? 'bg-accent' : 'bg-surface-raised',
        )}
      >
        <Icon size={22} color={action.primary === true ? ACCENT_FOREGROUND : ICON} />
      </View>
      <Text numberOfLines={1} className="text-[12px] text-muted-foreground">
        {action.label}
      </Text>
    </Pressable>
  );
}

/** The round action row under the profile header (T-1308), one key per action. */
export function ProfileActions({ actions }: { actions: ProfileAction[] }) {
  if (actions.length === 0) {
    return null;
  }
  return (
    <View className="flex-row flex-wrap justify-center gap-4">
      {actions.map((action) => (
        <ProfileActionButton key={action.key} action={action} />
      ))}
    </View>
  );
}

/**
 * The round action row for the profile's relation (T-1308): Message / Mute /
 * Search for a contact (the last two only once the DM exists), Send request
 * for a stranger, Cancel for a pending request, Accept / Decline when one
 * arrived. Reuses today's `api` calls and `openMessage` path.
 */
export function buildActions({
  profile,
  sent,
  busy,
  hasDm,
  muted,
  openMessage,
  toggleMute,
  openSearch,
  send,
  cancel,
  accept,
  decline,
  openRequests,
}: {
  profile: ProfilePerson | null;
  sent: boolean;
  busy: boolean;
  hasDm: boolean;
  muted: boolean;
  openMessage: () => void;
  toggleMute: () => void;
  openSearch: () => void;
  send: () => void;
  cancel: () => void;
  accept: () => void;
  decline: () => void;
  openRequests: () => void;
}): ProfileAction[] {
  if (profile === null) {
    return [];
  }
  const disabled = busy;
  if (profile.relation === 'contact') {
    const actions: ProfileAction[] = [
      { key: 'message', label: 'Message', icon: MessageCircle, onPress: openMessage, disabled },
    ];
    if (hasDm) {
      actions.push({
        key: 'mute',
        label: muted ? 'Unmute' : 'Mute',
        icon: muted ? BellOff : Bell,
        onPress: toggleMute,
        disabled,
      });
      actions.push({
        key: 'search',
        label: 'Search',
        icon: Search,
        onPress: openSearch,
        disabled,
      });
    }
    return actions;
  }
  if (profile.relation === 'request_received') {
    return [
      { key: 'accept', label: 'Accept', icon: Check, onPress: accept, disabled, primary: true },
      { key: 'decline', label: 'Decline', icon: X, onPress: decline, disabled },
      { key: 'requests', label: 'Requests', icon: Inbox, onPress: openRequests, disabled },
    ];
  }
  if (profile.relation === 'request_sent' || (profile.relation === 'none' && sent)) {
    return [{ key: 'cancel', label: 'Cancel', icon: X, onPress: cancel, disabled }];
  }
  if (profile.relation === 'none') {
    return [
      {
        key: 'send',
        label: 'Send request',
        icon: UserPlus,
        onPress: send,
        disabled,
        primary: true,
      },
    ];
  }
  return [];
}
