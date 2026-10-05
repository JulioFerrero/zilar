import { Ban } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { ContactRelation, HandleProfile } from '@/lib/contacts-api';

import { Avatar } from '../chat/avatar';

export type ProfileCardAction = 'send' | 'cancel' | 'accept' | 'decline' | 'message' | 'requests';

/**
 * True when the inline block confirm must be dropped because the card now
 * shows a different person or a different relation. A successful block or
 * unblock changes the relation, so resetting on that keeps the confirm from
 * reopening after an unblock (T-0244 review finding 1).
 */
export function shouldResetBlockConfirm(
  previous: { userId: string; relation: ContactRelation },
  next: { userId: string; relation: ContactRelation },
): boolean {
  return previous.userId !== next.userId || previous.relation !== next.relation;
}

/**
 * The profile card for a handle lookup (T-0182, mirrors the web
 * `AddContactDialog` found card): the name, avatar, @handle, and the right
 * action per relation. `self` renders nothing actionable. T-0244 adds the
 * silent block action with an inline confirm, and Unblock on a blocked
 * profile.
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
  onBlock,
  onUnblock,
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
  onBlock: () => void;
  onUnblock: () => void;
  /** Opens the full profile (the people-search row); absent keeps the header static. */
  onOpenProfile?: (() => void) | undefined;
}) {
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  // Reset during render on a different profile or relation (like the
  // add-contact sheet), so a new handle cannot inherit an open confirm from
  // the last one and a successful block/unblock closes it instead of letting
  // it reappear after the relation flips back to `none`.
  const [lastCard, setLastCard] = useState({
    userId: profile.userId,
    relation: profile.relation,
  });
  if (shouldResetBlockConfirm(lastCard, profile)) {
    setLastCard({ userId: profile.userId, relation: profile.relation });
    setConfirmingBlock(false);
  }

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
        name={profile.name}
        relation={profile.relation}
        sent={sent}
        busy={busy}
        blockConfirming={confirmingBlock}
        onSend={onSend}
        onCancel={onCancel}
        onAccept={onAccept}
        onDecline={onDecline}
        onMessage={onMessage}
        onOpenRequests={onOpenRequests}
        onStartBlock={() => setConfirmingBlock(true)}
        onCancelBlock={() => setConfirmingBlock(false)}
        onBlock={onBlock}
        onUnblock={onUnblock}
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
 * accepting inline, like the web dialog. Every non-self relation also gets
 * the muted Block action; a blocked profile shows Unblock instead.
 */
export function ProfileCardActionRow({
  name,
  relation,
  sent,
  busy,
  blockConfirming,
  onSend,
  onCancel,
  onAccept,
  onDecline,
  onMessage,
  onOpenRequests,
  onStartBlock,
  onCancelBlock,
  onBlock,
  onUnblock,
}: {
  name: string;
  relation: ContactRelation;
  sent: boolean;
  busy: boolean;
  blockConfirming: boolean;
  onSend: () => void;
  onCancel: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onMessage: () => void;
  onOpenRequests: () => void;
  onStartBlock: () => void;
  onCancelBlock: () => void;
  onBlock: () => void;
  onUnblock: () => void;
}) {
  if (relation === 'self') {
    return <Text className="mt-2 text-[14px] text-muted-foreground">That is you.</Text>;
  }
  if (relation === 'blocked') {
    return (
      <View className="mt-2">
        <Text className="text-[14px] text-muted-foreground">You blocked this person.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Unblock"
          disabled={busy}
          onPress={onUnblock}
          className="mt-2 self-start rounded-full border border-border-strong px-4 py-1.5 active:bg-surface-raised disabled:opacity-60"
        >
          <Text className="text-[14px] text-foreground">{busy ? 'Unblocking…' : 'Unblock'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      {relation === 'contact' ? (
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
      ) : relation === 'request_sent' ? (
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
      ) : relation === 'request_received' ? (
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
      ) : sent ? (
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
      ) : (
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
      )}

      {blockConfirming ? (
        <View className="mt-2 rounded-lg bg-surface-raised px-3 py-2.5">
          <Text className="text-[14px] text-foreground">
            Block {name}? They are not told. You won&apos;t see their contact requests.
          </Text>
          <View className="mt-2 flex-row gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm block"
              disabled={busy}
              onPress={onBlock}
              className="flex-row items-center gap-1.5 rounded-full bg-danger px-3 py-1.5 active:opacity-90 disabled:opacity-60"
            >
              <Ban size={14} color="#ffffff" />
              <Text className="text-[14px] font-medium text-white">
                {busy ? 'Blocking…' : 'Block'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel the block"
              disabled={busy}
              onPress={onCancelBlock}
              className="rounded-full border border-border-strong px-3 py-1.5 active:bg-surface disabled:opacity-60"
            >
              <Text className="text-[14px] text-foreground">Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Block"
          disabled={busy}
          onPress={onStartBlock}
          className="mt-2 self-start px-1 active:opacity-70 disabled:opacity-60"
        >
          <Text className="text-[14px] text-muted-foreground">Block</Text>
        </Pressable>
      )}
    </View>
  );
}
