import { Effect } from 'effect';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { resolveDmChatId } from '@/components/chat/dm-chat-id';
import { ContactList } from '@/components/contacts/contact-list';
import { contactsLoadFailure, performRemoveContact } from '@/components/contacts/contacts';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { RefreshScroll } from '@/components/settings/refresh-scroll';
import { useFocusList } from '@/components/settings/use-focus-list';
import { useProfileApi } from '@/components/settings/use-profile-api';
import { Button } from '@/components/ui/button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { domainOfJid, type Contact } from '@/lib/contacts-api';
import { fromApi } from '@/lib/effect/api-effect';
import { interruptFiber } from '@/lib/effect/timers';
import { useAction } from '@/lib/effect/use-action';
import { WEB_HOST } from '@/lib/web-host';
import { useChatStore } from '@/store/chat-store-provider';

type PageStatus = 'loading' | 'ready' | 'error';

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

  const list = useFocusList<Contact[]>(() =>
    Effect.tryPromise({
      try: () => api.listContacts(),
      catch: (loadError: unknown) => contactsLoadFailure(loadError),
    }),
  );
  const status: PageStatus = list.status;
  const people = list.data ?? [];
  const { setData, error, refreshing, refresh } = list;

  const [handle, setHandle] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

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

  // A contact's row carries the peer's real JID, so the DM resolves without guessing.
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
      setData((rows) => rows?.filter((row) => row.userId !== userId));
    });

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
      <ScreenHeader
        variant="sub"
        title="Contacts"
        subtitle="The people you can chat with."
        onBack={() => router.back()}
      />
      <RefreshScroll refreshing={refreshing} onRefresh={refresh}>
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
                onPress: () => refresh(),
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
      </RefreshScroll>
      {mock ? (
        <View className="items-center border-t border-divider px-4 py-1">
          <Text className="text-[12px] text-muted-foreground">Mock data</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
