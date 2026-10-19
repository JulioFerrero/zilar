import { Effect, type Effect as EffectType } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useFocusEffect, useRouter } from 'expo-router';
import { MoreVertical, User, UserMinus } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { resolveDmChatId } from '@/components/chat/dm-chat-id';
import {
  contactOnline,
  contactPresence,
  filterContacts,
  sortContactsByPresence,
} from '@/components/contacts/contact-presence';
import { ContactRow } from '@/components/contacts/contact-row';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { RefreshScroll } from '@/components/settings/refresh-scroll';
import { useFocusList } from '@/components/settings/use-focus-list';
import { useProfileApi } from '@/components/settings/use-profile-api';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SearchField } from '@/components/ui/search-field';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import { domainOfJid, type Contact, type ContactsApi } from '@/lib/contacts-api';
import type { ChatSummary } from '@/lib/types';
import { fromApi, interruptFiber } from '@zilar/client-core';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { WEB_HOST } from '@/lib/web-host';
import { useChatStore } from '@/store/chat-store-provider';
import { ApiError } from '@zilar/api-contract';

/**
 * The contacts page's remove flow, mirroring the web `ContactsPage`: every error
 * is a fixed sentence, never the server's raw message.
 */

const RATE_LIMIT_MESSAGE = 'Too many tries — wait a little and try again.';

function rateLimited(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 429 || error.code === 'rate_limited');
}

function contactsLoadFailure(error: unknown): string {
  if (rateLimited(error)) {
    return RATE_LIMIT_MESSAGE;
  }
  return 'Could not load contacts. Try again.';
}

function removeContactFailure(error: unknown): string {
  if (rateLimited(error)) {
    return RATE_LIMIT_MESSAGE;
  }
  if (error instanceof ApiError && error.status === 404) {
    return 'That person is no longer a contact.';
  }
  return 'Could not remove contact. Try again.';
}

const removeSteps = Effect.fnUntraced(function* (
  api: ContactsApi,
  userId: string,
  onRemoved: () => void,
): EffectType.fn.Return<void, unknown> {
  yield* Effect.tryPromise({ try: () => api.removeContact(userId), catch: (cause) => cause });
  yield* Effect.try({ try: onRemoved, catch: (cause) => cause });
});

const performRemoveContactEffect = (
  api: ContactsApi,
  userId: string,
  onRemoved: () => void,
): Effect.Effect<string | null> =>
  removeSteps(api, userId, onRemoved).pipe(
    Effect.map((): string | null => null),
    Effect.catch((error: unknown) => Effect.succeed(removeContactFailure(error))),
  );

function performRemoveContact(
  api: ContactsApi,
  userId: string,
  onRemoved: () => void,
): Promise<string | null> {
  return Effect.runPromise(performRemoveContactEffect(api, userId, onRemoved));
}

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

function subtitleFor(person: Contact, chats: ChatSummary[], now: Date): string {
  const presence = contactPresence(person, chats, now);
  if (presence !== undefined) {
    return presence;
  }
  return person.handle !== undefined && person.handle !== null ? `@${person.handle}` : '';
}

function ContactList({
  people,
  chats,
  onOpenChat,
  onViewProfile,
  onRemove,
}: {
  people: Contact[];
  chats: ChatSummary[];
  onOpenChat: (person: Contact) => void;
  onViewProfile: (handle: string) => void;
  onRemove: (userId: string) => Promise<string | null>;
}) {
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState<Contact | null>(null);
  const [confirmFor, setConfirmFor] = useState<Contact | null>(null);
  const now = new Date();

  const visible = useMemo(
    () => sortContactsByPresence(filterContacts(people, query), chats),
    [people, chats, query],
  );

  const [removeState, runRemove, removeControls] = useAction((person: Contact) =>
    Effect.promise(() => onRemove(person.userId)),
  );
  const removing = isWaiting(removeState);
  const removeFailure = AsyncResult.isSuccess(removeState) ? removeState.value : undefined;

  // A successful removal drops the row upstream; close the confirm with it.
  // Reset during render, so no effect synchronizes state.
  if (confirmFor !== null && AsyncResult.isSuccess(removeState) && removeState.value === null) {
    setConfirmFor(null);
  }

  const startRemove = (person: Contact) => {
    removeControls.reset();
    setMenuFor(null);
    setConfirmFor(person);
  };

  const closeConfirm = () => {
    if (!removing) {
      setConfirmFor(null);
    }
  };

  return (
    <>
      <SearchField
        value={query}
        onChangeText={setQuery}
        onClear={() => setQuery('')}
        maxLength={100}
        placeholder="Search contacts"
        accessibilityLabel="Search contacts"
        autoCapitalize="none"
        autoCorrect={false}
        containerClassName="mb-3"
      />

      {visible.length === 0 ? (
        <StateMessage
          kind="empty"
          title={people.length === 0 ? 'No contacts yet.' : 'No contacts match.'}
        />
      ) : (
        <View accessibilityRole="none" accessibilityLabel="Contacts">
          <Card>
            {visible.map((person) => (
              <ContactRow
                key={person.userId}
                person={person}
                subtitle={subtitleFor(person, chats, now)}
                online={contactOnline(person, chats)}
                accessibilityLabel={`Open the chat with ${person.name}`}
                onPress={() => onOpenChat(person)}
                onLongPress={() => setMenuFor(person)}
                trailing={
                  <IconButton
                    label={`More options for ${person.name}`}
                    onPress={() => setMenuFor(person)}
                    className="h-9 w-9"
                  >
                    <MoreVertical size={20} color={ICON} />
                  </IconButton>
                }
              />
            ))}
          </Card>
        </View>
      )}

      <ActionSheet
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        closeLabel="Close contact menu"
        title={menuFor?.name}
      >
        {menuFor?.handle !== undefined && menuFor.handle !== null && menuFor.handle !== '' ? (
          <ActionSheetItem
            label="View profile"
            icon={User}
            onPress={() => {
              const handle = menuFor.handle;
              if (handle !== undefined && handle !== null) {
                setMenuFor(null);
                onViewProfile(handle);
              }
            }}
          />
        ) : null}
        <ActionSheetItem
          label="Remove contact"
          icon={UserMinus}
          destructive
          onPress={() => {
            if (menuFor !== null) {
              startRemove(menuFor);
            }
          }}
        />
      </ActionSheet>

      <ActionSheet
        visible={confirmFor !== null}
        onClose={closeConfirm}
        closeLabel="Cancel removing contact"
        header={
          <View className="px-4 py-3">
            <Text className="text-[14px] text-foreground">
              {`Remove ${confirmFor?.name ?? ''}? They stay in your chats; you stop being contacts.`}
            </Text>
          </View>
        }
        error={typeof removeFailure === 'string' ? removeFailure : ''}
      >
        <ActionSheetItem
          label={removing ? 'Removing…' : 'Remove contact'}
          destructive
          disabled={removing}
          onPress={() => {
            if (confirmFor !== null) {
              runRemove(confirmFor);
            }
          }}
        />
        <ActionSheetItem label="Cancel" disabled={removing} onPress={closeConfirm} />
      </ActionSheet>
    </>
  );
}
