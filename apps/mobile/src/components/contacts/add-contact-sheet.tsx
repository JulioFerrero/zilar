import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import {
  contactChatId,
  ContactsApiError,
  domainOfJid,
  type ContactsApi,
  type HandleProfile,
} from '@/lib/contacts-api';

import {
  addContactHandle,
  addContactLookupFailure,
  addContactSendFailure,
  NO_USER_MESSAGE,
  type AddContactState,
} from './add-contact';
import { ProfileCard } from './profile-card';

/**
 * The "Add contact" sheet (T-0182, mirrors the web `AddContactDialog`): an
 * exact @handle field, a Look up button, and the profile card with the right
 * action per relation. Thin view: the owner passes the API and the
 * navigation callbacks.
 */
export function AddContactSheet({
  api,
  initialHandle,
  chats,
  myJid,
  onMessage,
  onOpenRequests,
  onClose,
}: {
  api: ContactsApi;
  initialHandle?: string | undefined;
  /** The loaded chats, to resolve a contact's DM without a refetch. */
  chats: { id: string; kind: string }[];
  /** The viewer's own bare JID, for the DM domain. */
  myJid: string | null | undefined;
  onMessage: (chatId: string) => void;
  onOpenRequests: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialHandle?.replace(/^@/, '') ?? '');
  const [view, setView] = useState<AddContactState>({ state: 'idle' });
  const [profile, setProfile] = useState<HandleProfile | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const handle = addContactHandle(query);

  // Reset on a new handle during render (like the chats screen's
  // `?searchChat=` handling), not in an effect: the effect below only
  // schedules the debounced lookup, never sets state synchronously.
  const [lastHandle, setLastHandle] = useState(handle);
  if (handle !== lastHandle) {
    setLastHandle(handle);
    setProfile(null);
    setView({ state: 'idle' });
    setActionError(null);
  }
  const looking = handle !== null && view.state === 'idle';

  useEffect(() => {
    if (handle === null) {
      return;
    }
    let active = true;
    const pending = setTimeout(() => {
      void api
        .lookupByHandle(handle)
        .then((found) => {
          if (active) {
            setProfile(found);
            setView({ state: 'found', sent: false });
            setActionError(null);
          }
        })
        .catch((error: unknown) => {
          if (active) {
            setView(addContactLookupFailure(error));
          }
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(pending);
    };
  }, [api, handle]);

  const runAction = (work: () => Promise<void>): void => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setActionBusy(true);
    setActionError(null);
    void work()
      .catch((error: unknown) => {
        setActionError(actionErrorFor(error));
      })
      .finally(() => {
        busyRef.current = false;
        setActionBusy(false);
      });
  };

  const reloadProfile = (): void => {
    if (handle === null) {
      return;
    }
    runAction(() =>
      api.lookupByHandle(handle).then((found) => {
        setProfile(found);
        setView({ state: 'found', sent: false });
      }),
    );
  };

  const send = (): void => {
    if (profile === null || handle === null || view.state !== 'found') {
      return;
    }
    const active = profile;
    runAction(() =>
      api.sendContactRequest(handle).then((created) => {
        if (created.incoming === true) {
          setProfile({ ...active, relation: 'request_received' });
          setView({ state: 'found', sent: false });
        } else {
          setView({ state: 'found', sent: true });
        }
      }),
    );
  };

  const actOnRequest = (work: (id: string) => Promise<unknown>): void => {
    if (profile === null) {
      return;
    }
    const targetUserId = profile.userId;
    runAction(() =>
      api.listContactRequests().then(async (list) => {
        const row = [...list.incoming, ...list.outgoing].find(
          (entry) => entry.other.userId === targetUserId,
        );
        if (row === undefined) {
          reloadProfile();
          return;
        }
        await work(row.id);
        reloadProfile();
      }),
    );
  };

  const openMessage = (): void => {
    if (profile === null) {
      return;
    }
    const target = resolveContactChat(chats, profile.userId, domainOfJid(myJid));
    if (target === undefined) {
      setActionError('No chat with them yet. Pull to refresh the chats list.');
      return;
    }
    onMessage(target);
  };

  return (
    <Pressable
      onPress={() => {}}
      className="w-full max-w-sm rounded-2xl border border-border-strong bg-surface p-4"
    >
      <Text className="text-[16px] font-semibold text-foreground">Add contact</Text>
      <Text className="mt-1 text-[14px] text-muted-foreground">
        Type their @username to find them.
      </Text>
      <View className="mt-3 flex-row items-center gap-2">
        <View className="flex-1 rounded-[10px] border border-border-strong bg-well px-3 py-2">
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="@ada"
            placeholderTextColor="#8a8a8a"
            accessibilityLabel="Username"
            maxLength={33}
            className="text-[15px] text-foreground"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Look up"
          disabled={handle === null}
          onPress={reloadProfile}
          className="rounded-full bg-accent px-4 py-2 active:opacity-90 disabled:opacity-60"
        >
          <Text className="text-[15px] font-medium text-accent-foreground">Look up</Text>
        </Pressable>
      </View>

      <View className="mt-4">
        {looking ? (
          <View className="items-center gap-2 py-2">
            <ActivityIndicator />
            <Text className="text-[14px] text-muted-foreground">Looking up…</Text>
          </View>
        ) : null}
        {view.state === 'missing' ? (
          <Text className="text-[14px] text-muted-foreground">{NO_USER_MESSAGE}</Text>
        ) : null}
        {view.state === 'error' ? (
          <Text accessibilityRole="alert" className="text-[14px] text-danger">
            {view.message}
          </Text>
        ) : null}
        {view.state === 'found' && profile !== null ? (
          <ProfileCard
            profile={profile}
            sent={view.sent}
            busy={actionBusy}
            error={actionError}
            onSend={send}
            onCancel={() => actOnRequest((id) => api.cancelContactRequest(id))}
            onAccept={() => actOnRequest((id) => api.acceptContactRequest(id))}
            onDecline={() => actOnRequest((id) => api.declineContactRequest(id))}
            onMessage={openMessage}
            onOpenRequests={onOpenRequests}
          />
        ) : null}
      </View>

      <View className="mt-4 flex-row justify-end">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          className="rounded-full bg-accent px-4 py-1.5 active:opacity-90"
        >
          <Text className="text-[15px] font-medium text-accent-foreground">Close</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

/**
 * Resolves a contact's DM chat id without a refetch: the loaded chats first
 * (the server lists every contact's DM), else the JID built from the user
 * id and the viewer's domain — only when that chat is also loaded, since a
 * guessed id that does not exist would open "Chat not found".
 */
export function resolveContactChat(
  chats: { id: string; kind: string }[],
  contactUserId: string,
  domain: string | undefined,
): string | undefined {
  if (domain === undefined) {
    return undefined;
  }
  const chatId = contactChatId(contactUserId, domain);
  return chats.some((chat) => chat.id === chatId) ? chatId : undefined;
}

function actionErrorFor(error: unknown): string {
  if (error instanceof ContactsApiError && error.status === 404) {
    return 'That request is no longer here.';
  }
  return addContactSendFailure(error);
}
