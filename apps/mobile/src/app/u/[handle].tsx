import { Effect } from 'effect';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ChevronLeft,
  Copy,
  Image,
  Bell,
  BellOff,
  Check,
  Inbox,
  MessageCircle,
  Search,
  UserPlus,
  X,
  Ban,
} from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type AvatarPersonInput, chatSubtitle, mutedUntilFor } from '@zilar/chat-core';

import { RequireAuth } from '@/auth/RequireAuth';
import {
  actOnProfileRequest,
  addContactLookupFailure,
  addContactSendFailure,
  NO_USER_MESSAGE,
} from '@/components/contacts/add-contact';
import { performBlock, performUnblock } from '@/components/contacts/blocks';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import type { ProfilePerson } from '@/components/profile/profile-person';
import { ActionTiles, type ActionTile } from '@/components/ui/action-tiles';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { Toast, type ToastMessage } from '@/components/ui/toast';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { domainOfJid, normalizeHandleInput } from '@/lib/contacts-api';
import { goBackOrHome } from '@/lib/navigation';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStore } from '@/store/chat-store-provider';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { MediaSheet } from '@/components/chat/media-sheet';
import { openSearchHitEffect } from '@/components/chat/search-jump';
import { InfoRow, InfoRowGroup } from '@/components/group-info/info-row';
import { Button } from '@/components/ui/button';
import { resolveDmChatId } from '@/components/chat/dm-chat-id';
import { fromThrown } from '@zilar/client-core';
import type { ContactRelation } from '@zilar/client-core';

type UseProfileDmOptions = {
  profile: ProfilePerson | null;
  domain: string | undefined;
  runPref: (work: Effect.Effect<unknown, unknown>) => void;
  setActionError: (message: string) => void;
  setToast: (toast: ToastMessage) => void;
};

function useProfileDm({ profile, domain, runPref, setActionError, setToast }: UseProfileDmOptions) {
  const router = useRouter();
  const chats = useChatStore((state) => state.chats);
  const contacts = useChatStore((state) => state.contacts);
  const reloadChats = useChatStore((state) => state.reloadChats);
  const setChatPref = useChatStore((state) => state.setChatPref);

  const dmChatId =
    profile === null || domain === undefined
      ? undefined
      : resolveDmChatId(profile.userId, contacts, domain);
  const dmChat = dmChatId === undefined ? undefined : chats.find((chat) => chat.id === dmChatId);
  const muted = dmChat?.muted === true;

  // The DM already exists on the server for every contact; the chat list only has
  // to catch up: push the chat id and reload the list. The lowercased id only
  // matches when the server kept it (`resolveDmChatId`), else a fixed error.
  const openMessage = (): void => {
    if (dmChatId === undefined) {
      setActionError('Could not open that chat. Try again.');
      return;
    }
    if (!chats.some((chat) => chat.id === dmChatId)) {
      reloadChats();
    }
    router.push({ pathname: '/chat/[id]', params: { id: dmChatId } });
  };

  const toggleMute = (): void => {
    if (dmChatId === undefined) {
      return;
    }
    const input = muted
      ? { mutedUntil: null }
      : { mutedUntil: mutedUntilFor('forever', new Date()) };
    runPref(fromThrown(() => setChatPref(dmChatId, input)));
  };

  const openSearch = (): void => {
    if (dmChatId === undefined) {
      return;
    }
    router.push({ pathname: '/', params: { searchChat: dmChatId } });
  };

  // Copies "@handle"; the toast confirms it. The clipboard module loads on first use.
  const copyUsername = (): void => {
    if (profile === null) {
      return;
    }
    const text = `@${profile.handle}`;
    Effect.runFork(
      Effect.tryPromise({ try: () => import('expo-clipboard'), catch: (cause) => cause }).pipe(
        Effect.flatMap((Clipboard) =>
          Effect.tryPromise({
            try: () => Clipboard.setStringAsync(text),
            catch: (cause) => cause,
          }),
        ),
        Effect.tap(() =>
          Effect.sync(() => setToast({ id: Date.now(), text: 'Username copied', tone: 'notice' })),
        ),
        Effect.ignore,
      ),
    );
  };

  const status =
    dmChat !== undefined
      ? chatSubtitle(dmChat, new Date())
      : profile === null
        ? ''
        : `@${profile.handle}`;
  const online = dmChat?.online === true;

  return { dmChatId, muted, status, online, openMessage, toggleMute, openSearch, copyUsername };
}

/**
 * True when the inline block confirm must be dropped because the card shows a
 * different person or relation: a successful block or unblock changes the
 * relation, so resetting on that keeps the confirm from reopening.
 */
function shouldResetBlockConfirm(
  previous: { userId: string; relation: ContactRelation },
  next: { userId: string; relation: ContactRelation },
): boolean {
  return previous.userId !== next.userId || previous.relation !== next.relation;
}

type ProfileBlockProps = {
  userId: string;
  name: string;
  relation: ContactRelation;
  busy: boolean;
  onBlock: () => void;
  onUnblock: () => void;
};

/**
 * The Block / Unblock row at the bottom of the profile, in the destructive red
 * token. The card's `shouldResetBlockConfirm` rule drops a stale confirm when
 * the person or the relation changes, e.g. right after a successful block.
 */
function ProfileBlock({ userId, name, relation, busy, onBlock, onUnblock }: ProfileBlockProps) {
  const [confirming, setConfirming] = useState(false);
  const [last, setLast] = useState({ userId, relation });
  if (shouldResetBlockConfirm(last, { userId, relation })) {
    setLast({ userId, relation });
    setConfirming(false);
  }

  if (relation === 'self') {
    return null;
  }

  if (relation === 'blocked') {
    return (
      <Button
        accessibilityLabel="Unblock"
        disabled={busy}
        onPress={onUnblock}
        variant="outline"
        size="default"
        className="self-center rounded-full px-6"
      >
        <Text>{busy ? 'Unblocking…' : 'Unblock'}</Text>
      </Button>
    );
  }

  if (confirming) {
    return (
      <View className="rounded-xl bg-surface-raised px-3 py-2.5">
        <Text className="text-[14px] leading-5 text-foreground">
          Block {name}? They are not told. You won&apos;t see their contact requests.
        </Text>
        <View className="mt-2 flex-row gap-2">
          <Button
            variant="destructive"
            size="sm"
            accessibilityLabel="Confirm block"
            disabled={busy}
            onPress={onBlock}
          >
            <Ban size={14} color="#ffffff" />
            <Text>{busy ? 'Blocking…' : 'Block'}</Text>
          </Button>
          <Button
            accessibilityLabel="Cancel the block"
            disabled={busy}
            onPress={() => setConfirming(false)}
            variant="outline"
            size="sm"
          >
            <Text>Cancel</Text>
          </Button>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Block"
      disabled={busy}
      onPress={() => setConfirming(true)}
      className="items-center rounded-xl border border-border bg-surface px-3 py-3 active:bg-surface-raised"
    >
      <Text className="text-[15px] font-medium text-danger">Block</Text>
    </Pressable>
  );
}

type ProfileAction = ActionTile;

function buildActions({
  profile,
  sent,
  busy,
  hasDm,
  muted,
  openMessage,
  toggleMute,
  openSearch,
  send,
  cancel,
  accept,
  decline,
  openRequests,
}: {
  profile: ProfilePerson | null;
  sent: boolean;
  busy: boolean;
  hasDm: boolean;
  muted: boolean;
  openMessage: () => void;
  toggleMute: () => void;
  openSearch: () => void;
  send: () => void;
  cancel: () => void;
  accept: () => void;
  decline: () => void;
  openRequests: () => void;
}): ProfileAction[] {
  if (profile === null) {
    return [];
  }
  const disabled = busy;
  if (profile.relation === 'contact') {
    const actions: ProfileAction[] = [
      { key: 'message', label: 'Message', icon: MessageCircle, onPress: openMessage, disabled },
    ];
    if (hasDm) {
      actions.push({
        key: 'mute',
        label: muted ? 'Unmute' : 'Mute',
        icon: muted ? BellOff : Bell,
        onPress: toggleMute,
        disabled,
      });
      actions.push({
        key: 'search',
        label: 'Search',
        icon: Search,
        onPress: openSearch,
        disabled,
      });
    }
    return actions;
  }
  if (profile.relation === 'request_received') {
    return [
      { key: 'accept', label: 'Accept', icon: Check, onPress: accept, disabled },
      { key: 'decline', label: 'Decline', icon: X, onPress: decline, disabled },
      { key: 'requests', label: 'Requests', icon: Inbox, onPress: openRequests, disabled },
    ];
  }
  if (profile.relation === 'request_sent' || (profile.relation === 'none' && sent)) {
    return [{ key: 'cancel', label: 'Cancel', icon: X, onPress: cancel, disabled }];
  }
  if (profile.relation === 'none') {
    return [
      {
        key: 'send',
        label: 'Send request',
        icon: UserPlus,
        onPress: send,
        disabled,
      },
    ];
  }
  return [];
}

type ProfileMediaProps = {
  chatId: string;
};

function ProfileMedia({ chatId }: ProfileMediaProps) {
  const router = useRouter();
  const openAtMessage = useChatStore((state) => state.openAtMessage);
  const [open, setOpen] = useState(false);

  const jump = (messageId: string) => {
    setOpen(false);
    Effect.runFork(
      openSearchHitEffect(
        {
          openAtMessage,
          pushChat: (id) => router.push({ pathname: '/chat/[id]', params: { id } }),
          pushChatNotFound: (id) =>
            router.push({ pathname: '/chat/[id]', params: { id, notFound: '1' } }),
          onNotFound: () => {},
        },
        chatId,
        messageId,
      ).pipe(
        Effect.catch(() => Effect.void),
        Effect.catchDefect(() => Effect.void),
      ),
    );
  };

  return (
    <>
      <InfoRowGroup>
        <InfoRow icon={Image} label="Shared media" onPress={() => setOpen(true)} />
      </InfoRowGroup>
      {open ? <MediaSheet chatId={chatId} onJump={jump} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

type ProfileInfoProps = {
  handle: string;
  bio?: string | undefined;
  onCopyUsername: () => void;
};

function ProfileInfo({ handle, bio, onCopyUsername }: ProfileInfoProps) {
  return (
    <View className="gap-0 overflow-hidden rounded-xl border border-border bg-surface">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Copy username"
        onPress={onCopyUsername}
        className="flex-row items-center justify-between px-3 py-2.5 active:bg-surface-raised"
      >
        <View className="min-w-0 flex-1">
          <Text className="text-[13px]" style={{ color: MUTED_FOREGROUND }}>
            Username
          </Text>
          <Text numberOfLines={1} className="mt-0.5 text-[15px] text-foreground">
            @{handle}
          </Text>
        </View>
        <Copy size={18} color={MUTED_FOREGROUND} />
      </Pressable>
      {bio === undefined || bio === '' ? null : (
        <View className="border-t border-divider px-3 py-2.5">
          <Text className="text-[13px]" style={{ color: MUTED_FOREGROUND }}>
            Bio
          </Text>
          <Text className="mt-0.5 text-[15px] leading-5 text-foreground">{bio}</Text>
        </View>
      )}
    </View>
  );
}

type ProfileHeaderProps = {
  person: AvatarPersonInput;
  status: string;
  online: boolean;
};

function ProfileHeader({ person, status, online }: ProfileHeaderProps) {
  return (
    <View className="items-center gap-1 pt-4">
      <EntityAvatar person={person} size={104} />
      <Text className="mt-2 text-[22px] font-semibold text-foreground">{person.name}</Text>
      <View className="flex-row items-center gap-1.5">
        {online ? <View className="h-2 w-2 rounded-full bg-online" /> : null}
        <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
          {status}
        </Text>
      </View>
    </View>
  );
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
