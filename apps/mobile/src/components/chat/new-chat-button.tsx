import { Data, Effect } from 'effect';
import { useRouter } from 'expo-router';
import {
  Compass,
  Hash,
  Link,
  Megaphone,
  MessageSquarePlus,
  Plus,
  Users,
} from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { Pressable, Share } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { createErrorText } from '@/components/chat/visibility-fields';
import { InviteSheet } from '@/components/chat/invite-sheet';
import { JoinLinkForm } from '@/components/chat/join-link';
import { NewChannelSheet } from '@/components/chat/new-channel-sheet';
import { NewMessageSheet } from '@/components/chat/new-message-sheet';
import { NewTopicGroupSheet } from '@/components/chat/new-topic-group-sheet';
import { runMobile } from '@/lib/effect/runtime';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { createInvitesApi } from '@/lib/invites-api';
import { getSessionToken } from '@/lib/session-token';
import { useKeyPress } from '@/components/ui/use-key-press';
import { ACCENT_FOREGROUND, KEY_PRIMARY_PRESSED_SHADOW, pressStyle, primaryKey } from '@/lib/depth';
import { useChatStore } from '@/store/chat-store-provider';

type NewChatAction = 'channel' | 'message' | 'invite' | 'join';

/**
 * Creating a channel, or opening its screen, failed. `reason` is the original
 * error: `createErrorText` reads its code and never shows its text.
 */
class CreateFailed extends Data.TaggedError('CreateFailed')<{ readonly reason: unknown }> {}

type ChannelInput = {
  title: string;
  description?: string;
  visibility?: 'public';
  handle?: string;
};

// The clipboard/share bridge for the invite box. `expo-clipboard` is imported
// lazily (the native module does not load under Vitest/Node). The sheet takes
// Promise callbacks, so each Effect runs through `runMobile` and a rejection
// is still the original error.
const copyToClipboard = (text: string): Effect.Effect<void, unknown> =>
  Effect.tryPromise({ try: () => import('expo-clipboard'), catch: (error) => error }).pipe(
    Effect.flatMap((Clipboard) =>
      Effect.tryPromise({ try: () => Clipboard.setStringAsync(text), catch: (error) => error }),
    ),
    Effect.asVoid,
  );

const shareViaSheet = (text: string): Effect.Effect<void, unknown> =>
  Effect.tryPromise({ try: () => Share.share({ message: text }), catch: (error) => error }).pipe(
    Effect.asVoid,
  );

/** The 56 px primary FAB with a "New channel" / "New group" / "New message" / "Join" menu. */
export function NewChatButton() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pressed, reduceMotion, setPressed } = useKeyPress();
  const [menuOpen, setMenuOpen] = useState(false);
  const [topicPickerOpen, setTopicPickerOpen] = useState(false);
  const [action, setAction] = useState<NewChatAction | undefined>(undefined);
  // The menu and each action are separate native sheets (T-1451). A hand-off
  // must wait for the current sheet to finish dismissing, or the next one
  // presents in the same commit and comes up without its dimmed backdrop.
  // `afterMenu` holds the follow-up to run once the menu has closed;
  // `pendingInvite` marks the New message → Invite hand-off.
  const afterMenu = useRef<(() => void) | undefined>(undefined);
  const pendingInvite = useRef(false);
  const createChannel = useChatStore((state) => state.createChannel);
  // Closes the dialog and opens the new group's screen; a throw here reads
  // like a failed create.
  const openGroupScreen = (groupId: string) =>
    Effect.try({
      try: () => {
        setAction(undefined);
        router.push({ pathname: '/group/[id]', params: { id: groupId } });
      },
      catch: (reason) => new CreateFailed({ reason }),
    });

  // T-0144: creating a channel refreshes the chat list first (the store
  // returns the new group id from the POST answer), then opens the
  // channel screen. A failure reads inline, never raw.
  // T-0228: public creates carry the handle; failures map to fixed
  // sentences.
  const [channelState, create] = useAction((input: ChannelInput) =>
    Effect.tryPromise({
      try: () => createChannel(input),
      catch: (reason) => new CreateFailed({ reason }),
    }).pipe(Effect.flatMap(openGroupScreen)),
  );
  const channelBusy = isWaiting(channelState);
  const channelFailure = failureOf(channelState);
  const channelError =
    !channelBusy && channelFailure !== undefined
      ? createErrorText(channelFailure.reason, 'channel')
      : '';
  // The invite box always talks to the real session API (a personal invite
  // link is meaningless offline), and this menu must stay importable under
  // the Node tests, whose `expo-router` mock has no `useGlobalSearchParams`.
  const invitesApi = useMemo(() => createInvitesApi(getSessionToken), []);

  // The clipboard/share bridge for the invite box: `expo-clipboard` cannot be
  // imported statically here (like `expo-secure-store` in `session-token.ts`,
  // the native module does not load under Vitest/Node), so it is imported
  // lazily and React Native's `Share` is only touched on press. The sheet
  // takes callbacks and this menu wires the real modules at the edge (the
  // `group/[id].tsx` pattern).
  const inviteShare = useMemo(
    () => ({
      copyText: (text: string): Promise<void> => runMobile(copyToClipboard(text)),
      shareText: (text: string): Promise<void> => runMobile(shareViaSheet(text)),
    }),
    [],
  );

  const openDialog = (next: NewChatAction) => {
    afterMenu.current = () => setAction(next);
    setMenuOpen(false);
  };

  // Runs when the menu sheet has fully dismissed: an item tap queued a
  // follow-up in `afterMenu`, a user dismissal queues nothing.
  const menuDismissed = () => {
    const run = afterMenu.current;
    afterMenu.current = undefined;
    run?.();
  };

  // `Invite a friend` hands off from the New message sheet to the Invite
  // sheet; the second presents only after the first has dismissed.
  const inviteFromMessage = () => {
    pendingInvite.current = true;
    setAction(undefined);
  };
  const messageClosed = () => {
    const invite = pendingInvite.current;
    pendingInvite.current = false;
    setAction(invite ? 'invite' : undefined);
  };

  // Pastes a link in the menu: the form parses it locally and the app opens
  // the join screen with the token (the token never appears in any message).
  const joinWithToken = (token: string) => {
    setAction(undefined);
    router.push({ pathname: '/join/[token]', params: { token } });
  };

  // T-1289/MUX-29: the picked group opens its own new-topic sheet on mount
  // (`?newTopic=1` is read by the group screen).
  const openNewTopic = (groupId: string) => {
    setTopicPickerOpen(false);
    router.push({ pathname: '/group/[id]', params: { id: groupId, newTopic: '1' } });
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New chat"
        accessibilityState={{ expanded: menuOpen }}
        onPress={() => setMenuOpen(true)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        className="absolute right-5 h-14 w-14 items-center justify-center rounded-[18px]"
        style={[
          primaryKey,
          pressStyle(pressed, KEY_PRIMARY_PRESSED_SHADOW, reduceMotion),
          // The floating tab bar (64 px + 12 px bottom gap) sits under the
          // chats list, so the FAB floats above it (T-0233).
          { bottom: Math.max(insets.bottom, 12) + 12 + 64 + 14 },
        ]}
      >
        <Plus size={24} color={ACCENT_FOREGROUND} />
      </Pressable>

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onDismissed={menuDismissed}
        closeLabel="Close new chat menu"
      >
        <ActionSheetItem
          label="New channel"
          icon={Megaphone}
          onPress={() => openDialog('channel')}
        />
        <ActionSheetItem
          label="New group"
          icon={Users}
          onPress={() => {
            setMenuOpen(false);
            router.push('/group/new');
          }}
        />
        <ActionSheetItem
          label="New message"
          icon={MessageSquarePlus}
          onPress={() => openDialog('message')}
        />
        <ActionSheetItem
          label="New topic"
          icon={Hash}
          onPress={() => {
            afterMenu.current = () => setTopicPickerOpen(true);
            setMenuOpen(false);
          }}
        />
        <ActionSheetItem
          label="Explore"
          accessibilityLabel="Explore public groups"
          icon={Compass}
          onPress={() => {
            setMenuOpen(false);
            router.push('/explore');
          }}
        />
        <ActionSheetItem label="Join with a link" icon={Link} onPress={() => openDialog('join')} />
      </ActionSheet>

      <NewTopicGroupSheet
        visible={topicPickerOpen}
        onClose={() => setTopicPickerOpen(false)}
        onPick={openNewTopic}
      />

      <NewChannelSheet
        visible={action === 'channel'}
        busy={channelBusy}
        error={channelError}
        onCreate={create}
        onClose={() => {
          if (!channelBusy) {
            setAction(undefined);
          }
        }}
      />

      <NewMessageSheet
        visible={action === 'message'}
        onInvite={inviteFromMessage}
        onClose={messageClosed}
      />

      <InviteSheet
        visible={action === 'invite'}
        api={invitesApi}
        copyText={inviteShare.copyText}
        shareText={inviteShare.shareText}
        onClose={() => setAction(undefined)}
      />

      <JoinLinkForm
        visible={action === 'join'}
        onSubmit={joinWithToken}
        onClose={() => setAction(undefined)}
      />
    </>
  );
}
