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
import { Pressable, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { createErrorText } from '@/components/chat/visibility-fields';
import { InviteSheet } from '@/components/chat/invite-sheet';
import { JoinLinkForm } from '@/components/chat/join-link';
import { NewChannelSheet } from '@/components/chat/new-channel-sheet';
import { NewTopicGroupSheet } from '@/components/chat/new-topic-group-sheet';
import { runMobile } from '@/lib/effect/runtime';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { createInvitesApi } from '@/lib/invites-api';
import { getSessionToken } from '@/lib/session-token';
import { useKeyPress } from '@/components/ui/use-key-press';
import { ACCENT_FOREGROUND, KEY_PRIMARY_PRESSED_SHADOW, pressStyle, primaryKey } from '@/lib/depth';
import { useChatStore } from '@/store/chat-store-provider';
import { ContactRow } from '@/components/contacts/contact-row';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { SearchField } from '@/components/ui/search-field';
import { Text } from '@/components/ui/text';
import type { Contact } from '@/lib/contacts-api';

// Case-insensitive prefix match on any word of the name, or on the handle.
function matchesFilter(contact: Contact, needle: string): boolean {
  if (needle === '') {
    return true;
  }
  if (
    contact.name
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.startsWith(needle))
  ) {
    return true;
  }
  const handle = contact.handle;
  return handle != null && handle.toLowerCase().startsWith(needle);
}

// The new-message box, the phone twin of web's `NewMessageDialog`: with no contacts it keeps the invite sentence; otherwise a search field lists contacts and a tap opens the DM, reloading the chat list when the chat is missing. `Invite a friend` is the one sticky footer key.
function NewMessageSheet({
  visible,
  onInvite,
  onClose,
}: {
  visible: boolean;
  onInvite: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const contacts = useChatStore((state) => state.contacts);
  const chats = useChatStore((state) => state.chats);
  const reloadChats = useChatStore((state) => state.reloadChats);
  const [query, setQuery] = useState('');

  // The sheet stays mounted while dismissed, so every close path clears the filter and the next open starts clean.
  const close = (): void => {
    setQuery('');
    onClose();
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return contacts.filter((contact) => matchesFilter(contact, needle));
  }, [contacts, query]);

  // The DM already exists server-side; the chat list only has to catch up.
  const openContact = (contact: Contact): void => {
    if (!chats.some((chat) => chat.id === contact.jid)) {
      reloadChats();
    }
    close();
    router.push({ pathname: '/chat/[id]', params: { id: contact.jid } });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      closeLabel="Close new message"
      title="New message"
      footer={
        <Button accessibilityLabel="Invite a friend" onPress={onInvite}>
          <Text>Invite a friend</Text>
        </Button>
      }
    >
      {contacts.length === 0 ? (
        <Text className="mt-1 text-[15px] text-muted-foreground">
          Invite a friend to start a conversation, or type their @username in the search bar above.
        </Text>
      ) : (
        <>
          <SearchField
            value={query}
            onChangeText={setQuery}
            onClear={() => setQuery('')}
            placeholder="Search contacts"
            accessibilityLabel="Search contacts"
            autoCorrect={false}
            autoCapitalize="none"
          />
          <View className="mt-2">
            {filtered.length === 0 ? (
              <Text className="py-6 text-center text-[14px] text-muted-foreground">
                No contacts found
              </Text>
            ) : (
              filtered.map((contact) => (
                <ContactRow
                  key={contact.userId}
                  person={contact}
                  subtitle={
                    contact.handle != null && contact.handle !== '' ? `@${contact.handle}` : ''
                  }
                  accessibilityLabel={`Open the chat with ${contact.name}`}
                  onPress={() => openContact(contact)}
                />
              ))
            )}
          </View>
        </>
      )}
    </BottomSheet>
  );
}

type NewChatAction = 'channel' | 'message' | 'invite' | 'join';

// A failed create or open: `reason` is the original error, whose code `createErrorText` reads; its text is never shown.
class CreateFailed extends Data.TaggedError('CreateFailed')<{ readonly reason: unknown }> {}

type ChannelInput = {
  title: string;
  description?: string;
  visibility?: 'public';
  handle?: string;
};

// `expo-clipboard` is imported lazily (the native module does not load under Vitest/Node); each Effect runs through `runMobile` so a rejection stays the original error.
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

export function NewChatButton() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pressed, reduceMotion, setPressed } = useKeyPress();
  const [menuOpen, setMenuOpen] = useState(false);
  const [topicPickerOpen, setTopicPickerOpen] = useState(false);
  const [action, setAction] = useState<NewChatAction | undefined>(undefined);
  // The menu and each action are separate native sheets. A hand-off must wait for the current sheet to dismiss, or the next presents in the same commit without its dimmed backdrop.
  const afterMenu = useRef<(() => void) | undefined>(undefined);
  const pendingInvite = useRef(false);
  const createChannel = useChatStore((state) => state.createChannel);
  // Closes the dialog and opens the new group's screen; a throw here reads like a failed create.
  const openGroupScreen = (groupId: string) =>
    Effect.try({
      try: () => {
        setAction(undefined);
        router.push({ pathname: '/group/[id]', params: { id: groupId } });
      },
      catch: (reason) => new CreateFailed({ reason }),
    });

  // A public create carries the handle; failures map to fixed sentences, never raw text.
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
  // The invite box talks to the real session API: a personal invite link is meaningless offline.
  const invitesApi = useMemo(() => createInvitesApi(getSessionToken), []);

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

  // Runs when the menu sheet has fully dismissed: a queued follow-up runs, a user dismissal queues nothing.
  const menuDismissed = () => {
    const run = afterMenu.current;
    afterMenu.current = undefined;
    run?.();
  };

  // `Invite a friend` hands off from the New message sheet; the second presents only after the first dismisses.
  const inviteFromMessage = () => {
    pendingInvite.current = true;
    setAction(undefined);
  };
  const messageClosed = () => {
    const invite = pendingInvite.current;
    pendingInvite.current = false;
    setAction(invite ? 'invite' : undefined);
  };

  // The form parses a pasted link locally and opens the join screen with the token; the token never appears in any message.
  const joinWithToken = (token: string) => {
    setAction(undefined);
    router.push({ pathname: '/join/[token]', params: { token } });
  };

  // The picked group opens its own new-topic sheet on mount (`?newTopic=1` is read by the group screen).
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
          // The floating tab bar (64 px + 12 px gap) sits under the chats list, so the FAB floats above it.
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
