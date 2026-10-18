import { Effect } from 'effect';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import {
  actOnProfileRequest,
  addContactLookupFailure,
  addContactSendFailure,
  NO_USER_MESSAGE,
} from '@/components/contacts/add-contact';
import { performBlock, performUnblock } from '@/components/contacts/blocks';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { buildActions } from '@/components/profile/profile-actions';
import { ProfileBlock } from '@/components/profile/profile-block';
import { ProfileHeader } from '@/components/profile/profile-header';
import { ProfileInfo } from '@/components/profile/profile-info';
import { ProfileMedia } from '@/components/profile/profile-media';
import type { ProfilePerson } from '@/components/profile/profile-person';
import { useProfileDm } from '@/components/profile/use-profile-dm';
import { ActionTiles } from '@/components/ui/action-tiles';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { Toast, type ToastMessage } from '@/components/ui/toast';
import { ICON } from '@/lib/colors';
import { domainOfJid, normalizeHandleInput } from '@/lib/contacts-api';
import { goBackOrHome } from '@/lib/navigation';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStore } from '@/store/chat-store-provider';

/** Lifts a *-api.ts call into an Effect that fails with the thrown error itself: the failure helpers read its class, status and code. */
function fromThrown<A>(call: () => Promise<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: call, catch: (cause) => cause });
}

export default function HandleScreen() {
  return (
    <RequireAuth>
      <HandleProfileView />
    </RequireAuth>
  );
}

function HandleProfileView() {
  const router = useRouter();
  const params = useLocalSearchParams<{ handle?: string }>();
  const rawHandle = typeof params.handle === 'string' ? params.handle : '';
  const handle = normalizeHandleInput(rawHandle);
  const { api } = useContactsApi();
  const me = useChatStore((state) => state.me);
  const domain = domainOfJid(me?.jid);
  const [profile, setProfile] = useState<ProfilePerson | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  // A focus reload refreshes the profile in place; a new handle takes the loading state and never shows the previous person.
  const loadedHandle = useRef<string | null>(null);

  const [, fetchProfile] = useAction(
    (value: string) =>
      fromThrown(() => api.lookupByHandle(value)).pipe(
        Effect.tap((found) =>
          Effect.sync(() => {
            setProfile(found);
            setSent(false);
            setLoading(false);
            loadedHandle.current = value;
          }),
        ),
        Effect.tapError((loadError) =>
          Effect.sync(() => {
            if (loadedHandle.current === value) {
              return;
            }
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
          }),
        ),
      ),
    { mode: 'replace' },
  );

  const load = useCallback(() => {
    if (handle === '') {
      setLoading(false);
      setMissing(true);
      return;
    }
    setLoading(loadedHandle.current !== handle);
    setMissing(false);
    setError('');
    fetchProfile(handle);
  }, [handle, fetchProfile]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // One profile action at a time: a press while one runs is dropped, and the card is busy for as long as it runs.
  const [actionState, runWork] = useAction((work: Effect.Effect<unknown, unknown>) =>
    Effect.sync(() => setActionError(null)).pipe(
      Effect.andThen(work),
      Effect.tapError((actionFailure) =>
        Effect.sync(() => setActionError(addContactSendFailure(actionFailure))),
      ),
    ),
  );
  const [prefState, runPref] = useAction((work: Effect.Effect<unknown, unknown>) =>
    Effect.sync(() => setActionError(null)).pipe(
      Effect.andThen(work),
      Effect.tapError(() => Effect.sync(() => setActionError('Could not save. Try again.'))),
    ),
  );
  const actionBusy = isWaiting(actionState) || isWaiting(prefState);

  const showFailure = (failure: string | null) =>
    Effect.sync(() => {
      if (failure !== null) {
        setActionError(failure);
      }
    });

  const send = (): void => {
    if (profile === null) {
      return;
    }
    const active = profile;
    runWork(
      fromThrown(() => api.sendContactRequest(active.handle)).pipe(
        Effect.tap((created) =>
          Effect.sync(() => {
            if (created.incoming === true) {
              setProfile({ ...active, relation: 'request_received' });
              setSent(false);
            } else {
              setSent(true);
            }
          }),
        ),
      ),
    );
  };

  const actOnRequest = (work: (id: string) => Promise<unknown>): void => {
    if (profile === null || handle === '') {
      return;
    }
    const target = { userId: profile.userId, handle };
    runWork(
      fromThrown(() =>
        actOnProfileRequest(
          api,
          target,
          work,
          (found) => setProfile(found),
          () => setSent(false),
        ),
      ),
    );
  };

  const block = (): void => {
    if (profile === null) {
      return;
    }
    const active = profile;
    runWork(
      fromThrown(() =>
        performBlock(api, active.userId, () => {
          setProfile({ ...active, relation: 'blocked' });
        }),
      ).pipe(Effect.tap(showFailure)),
    );
  };

  const unblock = (): void => {
    if (profile === null) {
      return;
    }
    const active = profile;
    runWork(
      fromThrown(() =>
        performUnblock(api, active.userId, () => {
          setProfile({ ...active, relation: 'none' });
        }),
      ).pipe(Effect.tap(showFailure)),
    );
  };

  const { dmChatId, muted, status, online, openMessage, toggleMute, openSearch, copyUsername } =
    useProfileDm({ profile, domain, runPref, setActionError, setToast });

  const actions = buildActions({
    profile,
    sent,
    busy: actionBusy,
    hasDm: dmChatId !== undefined,
    muted,
    openMessage,
    toggleMute,
    openSearch,
    send,
    cancel: () => actOnRequest((id) => api.cancelContactRequest(id)),
    accept: () => actOnRequest((id) => api.acceptContactRequest(id)),
    decline: () => actOnRequest((id) => api.declineContactRequest(id)),
    openRequests: () => router.push('/settings/requests'),
  });
  const requestNote =
    profile !== null && profile.relation === 'request_sent'
      ? 'Request sent. They have not answered yet.'
      : profile !== null && profile.relation === 'none' && sent
        ? 'Request sent.'
        : null;
  const selfNote = profile !== null && profile.relation === 'self' ? 'That is you.' : null;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center gap-1 px-2 py-2">
        <IconButton label="Back" onPress={() => goBackOrHome(router)}>
          <ChevronLeft size={24} color={ICON} />
        </IconButton>
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
            <View className="gap-6">
              <ProfileHeader person={profile} status={status} online={online} />
              <View className="gap-3">
                <ActionTiles items={actions} accessibilityLabel="Profile actions" />
                {requestNote !== null ? (
                  <Text className="text-center text-[13px] text-muted-foreground">
                    {requestNote}
                  </Text>
                ) : null}
                {selfNote !== null ? (
                  <Text className="text-center text-[14px] text-muted-foreground">{selfNote}</Text>
                ) : null}
                {actionError !== null ? (
                  <Text accessibilityRole="alert" className="text-center text-[14px] text-danger">
                    {actionError}
                  </Text>
                ) : null}
              </View>
              <ProfileInfo
                handle={profile.handle}
                bio={profile.bio}
                onCopyUsername={copyUsername}
              />
              {dmChatId !== undefined ? <ProfileMedia chatId={dmChatId} /> : null}
              <ProfileBlock
                userId={profile.userId}
                name={profile.name}
                relation={profile.relation}
                busy={actionBusy}
                onBlock={block}
                onUnblock={unblock}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </SafeAreaView>
  );
}

function describeLoad(error: unknown): string {
  const failure = addContactLookupFailure(error);
  return failure.state === 'error' ? failure.message : 'Could not load that profile. Try again.';
}
