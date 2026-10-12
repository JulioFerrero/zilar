import { Effect } from 'effect';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { Avatar } from '@/components/chat/avatar';
import { contactsLoadFailure, performRemoveContact } from '@/components/contacts/contacts';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { useProfileApi } from '@/components/settings/use-profile-api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import type { Contact } from '@/lib/contacts-api';
import { fromApi } from '@/lib/effect/api-effect';
import { interruptFiber } from '@/lib/effect/timers';
import { isWaiting, useAction } from '@/lib/effect/use-action';

type PageStatus = 'loading' | 'ready' | 'error';

/** The public web host share links use (`web-link.ts:13`; `app.json:33` maps `/@`). */
const WEB_HOST = 'https://chat.zilar.app';

/**
 * Settings → Contacts (T-1237, mirrors the web `ContactsPage`): the people you
 * can chat with. A row opens the DM; each row's Remove asks in place, then
 * calls the T-1233 remove route and drops the row. The Share button at the top
 * sends the same `/@handle` link the web shares.
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

  const [people, setPeople] = useState<Contact[]>([]);
  const [handle, setHandle] = useState<string | null>(null);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [error, setError] = useState('');

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
            setPeople([...contacts].sort((left, right) => left.name.localeCompare(right.name)));
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

  // One Remove: the row drops on success, a failure keeps it and shows the
  // fixed sentence. The row's own action stops a double tap.
  const remove = (userId: string): Effect.Effect<void> =>
    Effect.sync(() => setError('')).pipe(
      Effect.andThen(
        Effect.promise(() =>
          performRemoveContact(api, userId, () => {
            setPeople((rows) => rows.filter((row) => row.userId !== userId));
          }),
        ),
      ),
      Effect.tap((failure) =>
        Effect.sync(() => {
          if (failure !== null) {
            setError(failure);
          }
        }),
      ),
      Effect.asVoid,
    );

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
            <View accessibilityRole="none" accessibilityLabel="Contacts" className="gap-2">
              <Card>
                {people.map((person) => (
                  <ContactRow
                    key={person.userId}
                    person={person}
                    onOpen={() =>
                      router.push({ pathname: '/chat/[id]', params: { id: person.jid } })
                    }
                    onRemove={remove}
                  />
                ))}
              </Card>
            </View>
          ) : null}

          {error !== '' && status === 'ready' ? (
            <Text accessibilityRole="alert" className="mt-3 text-[14px] text-danger">
              {error}
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

/** One contact: the row body opens the DM; Remove asks in place, then removes. */
function ContactRow({
  person,
  onOpen,
  onRemove,
}: {
  person: Contact;
  onOpen: () => void;
  onRemove: (userId: string) => Effect.Effect<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, remove] = useAction<void, void, never>(() => onRemove(person.userId));
  const busy = isWaiting(state);
  return (
    <View className="px-3 py-2.5">
      <View className="flex-row items-center gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open the chat with ${person.name}`}
          onPress={onOpen}
          className="min-w-0 flex-1 flex-row items-center gap-3 active:opacity-80"
        >
          <Avatar id={person.jid} name={person.name} size={44} avatarUrl={person.avatarUrl} />
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
              {person.name}
              {person.handle !== undefined && person.handle !== null ? (
                <Text className="font-normal text-muted-foreground"> @{person.handle}</Text>
              ) : null}
            </Text>
          </View>
        </Pressable>
        <Button
          variant="outline"
          size="sm"
          accessibilityLabel={`Remove ${person.name}`}
          disabled={busy}
          onPress={() => setConfirming(true)}
        >
          <Text>Remove</Text>
        </Button>
      </View>
      {confirming ? (
        <View className="mt-2 gap-2 rounded-lg bg-surface-raised px-3 py-2.5">
          <Text className="text-[13px] text-foreground">
            Remove {person.name}? They stay in your chats; you stop being contacts.
          </Text>
          <View className="flex-row gap-2">
            <Button
              variant="destructive"
              size="sm"
              accessibilityLabel="Confirm remove contact"
              disabled={busy}
              onPress={() => remove()}
            >
              <Text>{busy ? 'Removing…' : 'Remove'}</Text>
            </Button>
            <Button
              variant="outline"
              size="sm"
              accessibilityLabel={`Cancel removing ${person.name}`}
              disabled={busy}
              onPress={() => setConfirming(false)}
            >
              <Text>Cancel</Text>
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}
