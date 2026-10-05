import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { ContactRelation, HandleProfile } from '@/lib/contacts-api';

import { Avatar } from '../chat/avatar';

export type ProfileCardAction = 'send' | 'cancel' | 'accept' | 'decline' | 'message' | 'requests';

/**
 * The profile card for a handle lookup (T-0182, mirrors the web
 * `AddContactDialog` found card): the name, avatar, @handle, and the right
 * action per relation. `self` renders nothing actionable.
 */
export function ProfileCard({
  profile,
  sent,
  busy,
  error,
  onSend,
  onCancel,
  onAccept,
  onDecline,
  onMessage,
  onOpenRequests,
  onOpenProfile,
}: {
  profile: HandleProfile;
  /** True after a request was just sent from this card. */
  sent: boolean;
  /** True while the card's action is in flight. */
  busy: boolean;
  /** The inline action failure, if any. */
  error: string | null;
  onSend: () => void;
  onCancel: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onMessage: () => void;
  onOpenRequests: () => void;
  /** Opens the full profile (the people-search row); absent keeps the header static. */
  onOpenProfile?: (() => void) | undefined;
}) {
  const header = (
    <View className="flex-row items-center gap-3">
      <Avatar id={profile.userId} name={profile.name} size={44} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
          {profile.name}
        </Text>
        <Text numberOfLines={1} className="text-[14px] text-muted-foreground">
          @{profile.handle}
        </Text>
      </View>
    </View>
  );
  return (
    <View className="rounded-xl border border-border bg-surface px-3 py-2.5">
      {onOpenProfile === undefined ? (
        header
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open profile of ${profile.name}`}
          onPress={onOpenProfile}
          className="active:opacity-80"
        >
          {header}
        </Pressable>
      )}
      <ProfileCardActionRow
        relation={profile.relation}
        sent={sent}
        busy={busy}
        onSend={onSend}
        onCancel={onCancel}
        onAccept={onAccept}
        onDecline={onDecline}
        onMessage={onMessage}
        onOpenRequests={onOpenRequests}
      />
      {error !== null ? (
        <Text accessibilityRole="alert" className="mt-2 text-[14px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The action row under the card, one per relation: Send request (`none`),
 * Request sent / Cancel (`request_sent`, or the just-sent state),
 * Accept / Decline (`request_received`), Message (`contact`), nothing for
 * `self`. The received case links to the requests screen instead of
 * accepting inline, like the web dialog.
 */
export function ProfileCardActionRow({
  relation,
  sent,
  busy,
  onSend,
  onCancel,
  onAccept,
  onDecline,
  onMessage,
  onOpenRequests,
}: {
  relation: ContactRelation;
  sent: boolean;
  busy: boolean;
  onSend: () => void;
  onCancel: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onMessage: () => void;
  onOpenRequests: () => void;
}) {
  if (relation === 'self') {
    return <Text className="mt-2 text-[14px] text-muted-foreground">That is you.</Text>;
  }
  if (relation === 'contact') {
    return (
      <View className="mt-2">
        <Text className="text-[14px] text-muted-foreground">You are already contacts.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Message"
          disabled={busy}
          onPress={onMessage}
          className="mt-2 self-start rounded-full bg-accent px-4 py-1.5 active:opacity-90 disabled:opacity-60"
        >
          <Text className="text-[14px] font-medium text-accent-foreground">Message</Text>
        </Pressable>
      </View>
    );
  }
  if (relation === 'request_sent') {
    return (
      <View className="mt-2">
        <Text className="text-[14px] text-muted-foreground">
          Request sent. They have not answered yet.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel the request"
          disabled={busy}
          onPress={onCancel}
          className="mt-2 self-start rounded-full border border-border-strong px-4 py-1.5 active:bg-surface-raised disabled:opacity-60"
        >
          <Text className="text-[14px] text-foreground">{busy ? 'Cancelling…' : 'Cancel'}</Text>
        </Pressable>
      </View>
    );
  }
  if (relation === 'request_received') {
    return (
      <View className="mt-2 flex-row gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Accept"
          disabled={busy}
          onPress={onAccept}
          className="rounded-full bg-accent px-4 py-1.5 active:opacity-90 disabled:opacity-60"
        >
          <Text className="text-[14px] font-medium text-accent-foreground">
            {busy ? 'Accepting…' : 'Accept'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Decline"
          disabled={busy}
          onPress={onDecline}
          className="rounded-full border border-border-strong px-4 py-1.5 active:bg-surface-raised disabled:opacity-60"
        >
          <Text className="text-[14px] text-foreground">Decline</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open contact requests"
          onPress={onOpenRequests}
          className="rounded-full px-2 py-1.5 active:bg-surface-raised"
        >
          <Text className="text-[14px] text-muted-foreground">Requests</Text>
        </Pressable>
      </View>
    );
  }
  if (sent) {
    return (
      <View className="mt-2">
        <Text className="text-[14px] text-muted-foreground">Request sent.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel the request"
          disabled={busy}
          onPress={onCancel}
          className="mt-2 self-start rounded-full border border-border-strong px-4 py-1.5 active:bg-surface-raised disabled:opacity-60"
        >
          <Text className="text-[14px] text-foreground">{busy ? 'Cancelling…' : 'Cancel'}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Send request"
      disabled={busy}
      onPress={onSend}
      className="mt-2 self-start rounded-full bg-accent px-4 py-1.5 active:opacity-90 disabled:opacity-60"
    >
      <Text className="text-[14px] font-medium text-accent-foreground">
        {busy ? 'Sending…' : 'Send request'}
      </Text>
    </Pressable>
  );
}
