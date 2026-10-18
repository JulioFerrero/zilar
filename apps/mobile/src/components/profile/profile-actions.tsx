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

import type { ProfilePerson } from '@/components/profile/profile-person';
import type { ActionTile } from '@/components/ui/action-tiles';

export type ProfileAction = ActionTile;

/**
 * The action row for the public profile's relation (T-1308): Message / Mute /
 * Search for a contact (the last two only once the DM exists), Send request
 * for a stranger, Cancel for a pending request, Accept / Decline when one
 * arrived. Reuses today's `api` calls and `openMessage` path; `[handle].tsx`
 * draws the result with `ActionTiles`.
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
      { key: 'accept', label: 'Accept', icon: Check, onPress: accept, disabled },
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
      },
    ];
  }
  return [];
}
