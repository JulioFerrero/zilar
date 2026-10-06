import { useRouter } from 'expo-router';
import { Compass, Link, Megaphone, MessageSquarePlus, Plus, Users } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { createErrorText } from '@/components/chat/visibility-fields';
import { InviteSheet } from '@/components/chat/invite-sheet';
import { JoinLinkForm } from '@/components/chat/join-link';
import { NewChannelSheet } from '@/components/chat/new-channel-sheet';
import { NewGroupSheet } from '@/components/chat/new-group-sheet';
import { NewMessageSheet } from '@/components/chat/new-message-sheet';
import { createInvitesApi } from '@/lib/invites-api';
import { getSessionToken } from '@/lib/session-token';
import { useKeyboardHeight } from '@/lib/use-keyboard-height';
import { useKeyPress } from '@/components/ui/use-key-press';
import { ACCENT_FOREGROUND, KEY_PRIMARY_PRESSED_SHADOW, pressStyle, primaryKey } from '@/lib/depth';
import { useChatStore } from '@/store/chat-store-provider';

type NewChatAction = 'channel' | 'group' | 'message' | 'invite' | 'join';

/**
 * The action-dialog scroll keeps Create taps while the sheet keyboard is
 * open (T-0234): a tap on Create creates at once instead of only dismissing
 * the keyboard. Pure so tests can cover it without mounting the dialog.
 */
export const CREATE_SHEETS_SCROLL_TAPS_PERSIST = 'handled' as const;

/**
 * T-0254: the bottom padding of the create sheets' scroll content. On Android
 * the window no longer resizes for the keyboard (edge-to-edge, Expo SDK 57), so
 * the content is padded by the keyboard height on top of the 16 px the sheet
 * already has, letting a tall sheet scroll its last field and Create into view.
 * On iOS `KeyboardAvoidingView` keeps its own `padding` behaviour, so no extra
 * padding is added here (pure, so tests can cover the rule without a renderer).
 */
export function createSheetBottomPadding(
  platform: string,
  keyboardHeight: number,
): number | undefined {
  return platform === 'android' ? 16 + keyboardHeight : undefined;
}

/** The 56 px primary FAB with a "New channel" / "New group" / "New message" / "Join" menu. */
export function NewChatButton() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pressed, reduceMotion, setPressed } = useKeyPress();
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<NewChatAction | undefined>(undefined);
  const createChannel = useChatStore((state) => state.createChannel);
  const createGroup = useChatStore((state) => state.createGroup);
  const contacts = useChatStore((state) => state.contacts);
  const [channelBusy, setChannelBusy] = useState(false);
  const [channelError, setChannelError] = useState('');
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState('');
  // T-0254: pad the sheet content by the keyboard height on Android and scroll
  // to its end when the keyboard opens, so the lowest field and Create stay
  // reachable. The ref only fires while the modal is mounted.
  const keyboardHeight = useKeyboardHeight();
  const sheetsRef = useRef<ScrollView>(null);
  const previousKeyboardHeight = useRef(0);
  useEffect(() => {
    if (previousKeyboardHeight.current === 0 && keyboardHeight > 0) {
      sheetsRef.current?.scrollToEnd({ animated: true });
    }
    previousKeyboardHeight.current = keyboardHeight;
  }, [keyboardHeight]);
  // The invite box always talks to the real session API (a personal invite
  // link is meaningless offline): the mock-capable `useInvitesApi` hook stays
  // available for mock-mode surfaces, but this menu must stay importable
  // under the Node tests, whose `expo-router` mock has no
  // `useGlobalSearchParams`.
  const invitesApi = useMemo(() => createInvitesApi(getSessionToken), []);

  // The clipboard/share bridge for the invite box: `expo-clipboard` cannot be
  // imported statically here (like `expo-secure-store` in `session-token.ts`,
  // the native module does not load under Vitest/Node), so it is imported
  // lazily and React Native's `Share` is only touched on press. The sheet
  // takes callbacks and this menu wires the real modules at the edge (the
  // `group/[id].tsx` pattern).
  const inviteShare = useMemo(
    () => ({
      copyText: (text: string) =>
        import('expo-clipboard').then((Clipboard) => Clipboard.setStringAsync(text)).then(() => {}),
      shareText: async (text: string): Promise<void> => {
        await Share.share({ message: text });
      },
    }),
    [],
  );

  const openDialog = (next: NewChatAction) => {
    setMenuOpen(false);
    setAction(next);
  };

  // Pastes a link in the menu: the form parses it locally and the app opens
  // the join screen with the token (the token never appears in any message).
  const joinWithToken = (token: string) => {
    setAction(undefined);
    router.push({ pathname: '/join/[token]', params: { token } });
  };

  // T-0144: creating a channel refreshes the chat list first (the store
  // returns the new group id from the POST answer), then opens the
  // channel screen. A failure reads inline, never raw.
  // T-0228: public creates carry the handle; failures map to fixed
  // sentences.
  const create = (input: {
    title: string;
    description?: string;
    visibility?: 'public';
    handle?: string;
  }) => {
    setChannelBusy(true);
    setChannelError('');
    void createChannel(input)
      .then((groupId) => {
        setAction(undefined);
        router.push({ pathname: '/group/[id]', params: { id: groupId } });
      })
      .catch((error: unknown) => setChannelError(createErrorText(error, 'channel')))
      .finally(() => setChannelBusy(false));
  };

  // T-0214: creating a group mirrors the channel flow (the store
  // returns the new group id from the POST answer), then opens the
  // group screen. A failure reads inline, never raw.
  const submitGroup = (input: {
    title: string;
    memberIds: string[];
    visibility?: 'public';
    handle?: string;
  }) => {
    setGroupBusy(true);
    setGroupError('');
    void createGroup(input)
      .then((groupId) => {
        setAction(undefined);
        router.push({ pathname: '/group/[id]', params: { id: groupId } });
      })
      .catch((error: unknown) => setGroupError(createErrorText(error, 'group')))
      .finally(() => setGroupBusy(false));
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
        closeLabel="Close new chat menu"
      >
        <ActionSheetItem
          label="New channel"
          icon={Megaphone}
          onPress={() => openDialog('channel')}
        />
        <ActionSheetItem label="New group" icon={Users} onPress={() => openDialog('group')} />
        <ActionSheetItem
          label="New message"
          icon={MessageSquarePlus}
          onPress={() => openDialog('message')}
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

      <Modal
        visible={action !== undefined}
        transparent
        animationType="fade"
        onRequestClose={() => setAction(undefined)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          <ScrollView
            ref={sheetsRef}
            keyboardShouldPersistTaps={CREATE_SHEETS_SCROLL_TAPS_PERSIST}
            contentContainerStyle={{
              flexGrow: 1,
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              paddingBottom: createSheetBottomPadding(Platform.OS, keyboardHeight),
            }}
            className="flex-1 bg-black/40"
          >
            <Pressable
              accessibilityLabel="Close dialog"
              onPress={() => setAction(undefined)}
              className="absolute inset-0"
            />
            {action === 'join' ? (
              <JoinLinkForm onSubmit={joinWithToken} />
            ) : action === 'channel' ? (
              <NewChannelSheet
                busy={channelBusy}
                error={channelError}
                onCreate={create}
                onClose={() => {
                  if (!channelBusy) {
                    setAction(undefined);
                  }
                }}
              />
            ) : action === 'group' ? (
              <NewGroupSheet
                contacts={contacts}
                busy={groupBusy}
                error={groupError}
                onCreate={submitGroup}
                onClose={() => {
                  if (!groupBusy) {
                    setAction(undefined);
                  }
                }}
              />
            ) : action === 'message' ? (
              <NewMessageSheet
                onInvite={() => setAction('invite')}
                onClose={() => setAction(undefined)}
              />
            ) : action === 'invite' ? (
              <InviteSheet
                api={invitesApi}
                copyText={inviteShare.copyText}
                shareText={inviteShare.shareText}
                onClose={() => setAction(undefined)}
              />
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
