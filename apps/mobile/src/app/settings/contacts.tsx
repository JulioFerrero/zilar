import { Effect } from 'effect';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { resolveDmChatId } from '@/components/chat/dm-chat-id';
import { ContactList } from '@/components/contacts/contact-list';
import { contactsLoadFailure, performRemoveContact } from '@/components/contacts/contacts';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { useProfileApi } from '@/components/settings/use-profile-api';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import { domainOfJid, type Contact } from '@/lib/contacts-api';
import { fromApi } from '@/lib/effect/api-effect';
import { interruptFiber } from '@/lib/effect/timers';
import { useAction } from '@/lib/effect/use-action';
import { WEB_HOST } from '@/lib/web-host';
import { useChatStore } from '@/store/chat-store-provider';

type PageStatus = 'loading' | 'ready' | 'error';

/**
 * Settings → Contacts (T-1237, T-1314 Telegram-style): the people you can chat
 * with. Each row shows the name plus the presence the chat header uses, a tap
 * opens the DM, and a "⋯" menu offers View profile and Remove contact (with the
 * inline confirm). The Share button sends the same `/@handle` link the web
 * shares.
 */
export default function ContactsScreen() {
  return (
    <RequireAuth>
      <ContactsList />
    </RequireAuth>
  );
}

function ContactsList() {
  const router = useRouter();
  const { api, mock } = useContactsApi();
  const { api: profileApi } = useProfileApi();
  const chats = useChatStore((state) => state.chats);
  const meJid = useChatStore((state) => state.me?.jid ?? undefined);
  const reloadChats = useChatStore((state) => state.reloadChats);

  const [people, setPeople] = useState<Contact[]>([]);
  const [handle, setHandle] = useState<string | null>(null);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  // A new load replaces one still running (the focus refresh and Retry).
  const [, reload] = useAction<void, void, never>(
    () =>
      Effect.sync(() => {
        setStatus('loading');
        setError('');
      }).pipe(
        Effect.andThen(
          Effect.tryPromise({
            try: () => api.listContacts(),
            catch: (loadError: unknown) => contactsLoadFailure(loadError),
          }),
        ),
        Effect.tap((contacts) =>
          Effect.sync(() => {
            setPeople([...contacts]);
            setStatus('ready');
          }),
        ),
        Effect.catch((message: string) =>
          Effect.sync(() => {
            setError(message);
            setStatus('error');
          }),
        ),
      ),
    { mode: 'replace' },
  );

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // The share link needs the caller's handle, which the session does not carry
  // (`Me` has no handle); the profile lookup failing only hides the button.
  useFocusEffect(
    useCallback(() => {
      const load = Effect.runFork(
        fromApi(() => profileApi.getMe()).pipe(
          Effect.tap((profile) => Effect.sync(() => setHandle(profile.handle))),
          Effect.catch(() => Effect.sync(() => setHandle(null))),
        ),
      );
      return () => {
        interruptFiber(load);
      };
    }, [profileApi]),
  );

  // The profile's Message button uses the same helper (T-1288): a contact's row
  // carries the peer's real JID, so the DM resolves without guessing. The chat
  // screen's skeleton covers the wait when the list has not caught up yet.
  const openChat = (person: Contact): void => {
    setActionError('');
    const domain = domainOfJid(meJid);
    if (domain === undefined) {
      setActionError('Could not open that chat. Try again.');
      return;
    }
    const chatId = resolveDmChatId(person.userId, people, domain);
    if (chatId === undefined) {
      setActionError('Could not open that chat. Try again.');
      return;
    }
    if (!chats.some((chat) => chat.id === chatId)) {
      reloadChats();
    }
    router.push({ pathname: '/chat/[id]', params: { id: chatId } });
  };

  const removeContact = (userId: string): Promise<string | null> =>
    performRemoveContact(api, userId, () => {
      setPeople((rows) => rows.filter((row) => row.userId !== userId));
    });

  // `Share.share` sends the same `https://<host>/@handle` link the web page does.
  const [, share] = useAction(
    (url: string) =>
      Effect.tryPromise({ try: () => Share.share({ message: url }), catch: (cause) => cause }).pipe(
        Effect.ignore,
      ),
    { mode: 'replace' },
  );

  const shareUrl = handle === null ? null : `${WEB_HOST}/@${encodeURIComponent(handle)}`;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center gap-1 px-2 py-2">
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={24} color={ICON} />
        </IconButton>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[20px] font-semibold leading-6 text-foreground">
            Contacts
          </Text>
          <Text numberOfLines={1} className="mt-0.5 text-[14px] leading-5 text-muted-foreground">
            The people you can chat with.
          </Text>
        </View>
      </View>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View className="p-4">
          {shareUrl !== null ? (
            <Button
              variant="outline"
              className="mb-4"
              accessibilityLabel="Share my profile"
              onPress={() => share(shareUrl)}
            >
              <Text>Share my profile</Text>
            </Button>
          ) : null}

          {status === 'loading' ? <StateMessage kind="loading" title="Loading contacts…" /> : null}

          {status === 'error' ? (
            <StateMessage
              kind="error"
              title={error}
              action={{
                label: 'Retry',
                accessibilityLabel: 'Retry loading contacts',
                onPress: () => reload(),
              }}
            />
          ) : null}

          {status === 'ready' && people.length === 0 ? (
            <StateMessage kind="empty" title="No contacts yet." />
          ) : null}

          {status === 'ready' && people.length > 0 ? (
            <ContactList
              people={people}
              chats={chats}
              onOpenChat={openChat}
              onViewProfile={(profileHandle) =>
                router.push({ pathname: '/u/[handle]', params: { handle: profileHandle } })
              }
              onRemove={removeContact}
            />
          ) : null}

          {actionError !== '' && status === 'ready' ? (
            <Text accessibilityRole="alert" className="mt-3 text-[14px] text-danger">
              {actionError}
            </Text>
          ) : null}
        </View>
      </ScrollView>
      {mock ? (
        <View className="items-center border-t border-divider px-4 py-1">
          <Text className="text-[12px] text-muted-foreground">Mock data</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
