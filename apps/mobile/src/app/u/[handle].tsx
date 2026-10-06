import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';

import { RequireAuth } from '@/auth/RequireAuth';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { ICON } from '@/lib/colors';
import {
  contactChatId,
  domainOfJid,
  normalizeHandleInput,
  type HandleProfile,
} from '@/lib/contacts-api';
import {
  actOnProfileRequest,
  addContactLookupFailure,
  addContactSendFailure,
  NO_USER_MESSAGE,
} from '@/components/contacts/add-contact';
import { performBlock, performUnblock } from '@/components/contacts/blocks';
import { ProfileCard } from '@/components/contacts/profile-card';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { useChatStore } from '@/store/chat-store-provider';

/**
 * The `@handle` profile screen (T-0182, the mobile twin of the web
 * `/u/:handle` route): the same profile card as the add-contact sheet, so a
 * link or a tap on a name can open it. States: loading, the card, one plain
 * "No user with that username" for a bad handle, and an error with Retry.
 */
export default function HandleScreen() {
  return (
    <RequireAuth>
      <HandleProfileView />
    </RequireAuth>
  );
}

function HandleProfileView() {
  const router = useRouter();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const params = useLocalSearchParams<{ handle?: string }>();
  const rawHandle = typeof params.handle === 'string' ? params.handle : '';
  const handle = normalizeHandleInput(rawHandle);
  const { api } = useContactsApi();
  const chats = useChatStore((state) => state.chats);
  const me = useChatStore((state) => state.me);

  const [profile, setProfile] = useState<HandleProfile | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const load = useCallback(() => {
    if (handle === '') {
      setLoading(false);
      setMissing(true);
      return;
    }
    setLoading(true);
    setMissing(false);
    setError('');
    void api
      .lookupByHandle(handle)
      .then((found) => {
        setProfile(found);
        setSent(false);
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (
          loadError !== null &&
          typeof loadError === 'object' &&
          'status' in loadError &&
          loadError.status === 404
        ) {
          setMissing(true);
          setLoading(false);
          return;
        }
        setError(describeLoad(loadError));
        setLoading(false);
      });
  }, [api, handle]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const runAction = (work: () => Promise<void>): void => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setActionBusy(true);
    setActionError(null);
    void work()
      .catch((actionFailure: unknown) => {
        setActionError(addContactSendFailure(actionFailure));
      })
      .finally(() => {
        busyRef.current = false;
        setActionBusy(false);
      });
  };

  const send = (): void => {
    if (profile === null) {
      return;
    }
    const active = profile;
    runAction(() =>
      api.sendContactRequest(active.handle).then((created) => {
        if (created.incoming === true) {
          setProfile({ ...active, relation: 'request_received' });
          setSent(false);
        } else {
          setSent(true);
        }
      }),
    );
  };

  const actOnRequest = (work: (id: string) => Promise<unknown>): void => {
    if (profile === null || handle === '') {
      return;
    }
    const target = { userId: profile.userId, handle };
    runAction(() => actOnProfileRequest(api, target, work, setProfile, () => setSent(false)));
  };

  const block = (): void => {
    if (profile === null) {
      return;
    }
    const active = profile;
    runAction(async () => {
      const failure = await performBlock(api, active.userId, () => {
        setProfile({ ...active, relation: 'blocked' });
      });
      if (failure !== null) {
        setActionError(failure);
      }
    });
  };

  const unblock = (): void => {
    if (profile === null) {
      return;
    }
    const active = profile;
    runAction(async () => {
      const failure = await performUnblock(api, active.userId, () => {
        setProfile({ ...active, relation: 'none' });
      });
      if (failure !== null) {
        setActionError(failure);
      }
    });
  };

  const openMessage = (): void => {
    if (profile === null) {
      return;
    }
    const domain = domainOfJid(me?.jid);
    if (domain === undefined) {
      setActionError('No chat with them yet. Pull to refresh the chats list.');
      return;
    }
    const chatId = contactChatId(profile.userId, domain);
    if (!chats.some((chat) => chat.id === chatId)) {
      setActionError('No chat with them yet. Pull to refresh the chats list.');
      return;
    }
    router.push({ pathname: '/chat/[id]', params: { id: chatId } });
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center gap-1 px-2 py-2">
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={24} color={ICON[scheme]} />
        </IconButton>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[20px] font-semibold leading-6 text-foreground">
            {profile === null ? `@${rawHandle}` : `@${profile.handle}`}
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
          {loading ? <StateMessage kind="loading" title="Loading…" /> : null}
          {!loading && missing ? <StateMessage kind="empty" title={NO_USER_MESSAGE} /> : null}
          {!loading && !missing && error !== '' ? (
            <StateMessage
              kind="error"
              title={error}
              action={{
                label: 'Retry',
                onPress: load,
                accessibilityLabel: 'Retry loading the profile',
              }}
            />
          ) : null}
          {!loading && !missing && error === '' && profile !== null ? (
            <ProfileCard
              profile={profile}
              sent={sent}
              busy={actionBusy}
              error={actionError}
              onSend={send}
              onCancel={() => actOnRequest((id) => api.cancelContactRequest(id))}
              onAccept={() => actOnRequest((id) => api.acceptContactRequest(id))}
              onDecline={() => actOnRequest((id) => api.declineContactRequest(id))}
              onMessage={openMessage}
              onOpenRequests={() => router.push('/settings/requests')}
              onBlock={block}
              onUnblock={unblock}
            />
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function describeLoad(error: unknown): string {
  const failure = addContactLookupFailure(error);
  return failure.state === 'error' ? failure.message : 'Could not load that profile. Try again.';
}
