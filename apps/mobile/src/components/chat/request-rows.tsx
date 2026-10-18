// effect-plain: presentational request rows; the contacts api owns the transport; a local undo timer only.
import { useFocusEffect, useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useContactRequestsPoll } from '@zilar/client-core';
import { Effect } from 'effect';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { performRequestAction } from '@/components/contacts/requests';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import type { ToastMessage } from '@/components/ui/toast';
import { ICON } from '@/lib/colors';
import type { ContactRequestView, ContactsApi } from '@/lib/contacts-api';
import { useChatStore, useChatStoreApi } from '@/store/chat-store-provider';
import { onForeground } from '../../lib/foreground';

const list = (api: ContactsApi): Promise<ContactRequestView[]> =>
  Effect.runPromise(
    Effect.promise(() => api.listContactRequests()).pipe(Effect.map((page) => page.incoming)),
  );

function useContactRequests(
  api: ContactsApi,
  enabled: boolean,
): {
  requests: ContactRequestView[];
  reload: () => void;
} {
  return useContactRequestsPoll(() => list(api), enabled, onForeground);
}

/** At most this many rows before the list collapses into "See all N requests". */
const MAX_ROWS = 3;
/** How long a declined row stays undoable before the decline reaches the server. */
const UNDO_MS = 5000;

const ACCEPT_FAILED = 'Could not accept that request. Try again.';
const DECLINE_FAILED = 'Could not decline that request. Try again.';

function without(id: string, ids: ReadonlySet<string>): ReadonlySet<string> {
  const next = new Set(ids);
  next.delete(id);
  return next;
}

// One row per incoming contact request at the top of the chat list. Accept adds the contact and opens the DM; Decline drops the row for a 5-second Undo window before the call reaches the server. More than three collapse into "See all N requests".
export function ContactRequestRows({ onToast }: { onToast: (toast: ToastMessage) => void }) {
  const router = useRouter();
  const { api } = useContactsApi();
  const reloadChats = useChatStore((state) => state.reloadChats);
  const storeApi = useChatStoreApi();
  const { requests, reload } = useContactRequests(api, true);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pendingDecline, setPendingDecline] = useState<ContactRequestView | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingRef = useRef<ContactRequestView | undefined>(undefined);

  // Leaving the list ends the Undo window: the decline goes through at once.
  useEffect(
    () => () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
      }
      if (pendingRef.current !== undefined) {
        void api.declineContactRequest(pendingRef.current.id).catch(() => undefined);
      }
    },
    [api],
  );

  const hide = (id: string): void => setHidden((ids) => new Set(ids).add(id));

  const accept = (request: ContactRequestView): void => {
    setError(undefined);
    setBusyId(request.id);
    void performRequestAction(api, request.id, 'accept', hide)
      .then(async (failure) => {
        if (failure !== null) {
          // A user-facing error is always a fixed sentence, even when the helper falls back to raw server text.
          setError(ACCEPT_FAILED);
          return;
        }
        onToast({ id: Date.now(), text: `${request.other.name} added`, tone: 'notice' });
        // The DM already exists server-side; refresh so it lands at the top, then open it when its JID is known.
        reloadChats();
        try {
          const contacts = await api.listContacts();
          // Push the new contact into the store so the screens that read it see them.
          storeApi.setState({ contacts });
          const contact = contacts.find((entry) => entry.userId === request.other.userId);
          if (contact !== undefined) {
            router.push({ pathname: '/chat/[id]', params: { id: contact.jid } });
          }
        } catch {
          // The refreshed list shows the new chat at the top either way.
        }
      })
      .finally(() => {
        setBusyId(undefined);
        reload();
      });
  };

  // The decline waits out Undo: the row disappears at once but the request exists on the server until the timer fires.
  const commitDecline = (request: ContactRequestView): void => {
    pendingRef.current = undefined;
    setPendingDecline(undefined);
    void api
      .declineContactRequest(request.id)
      .then(() => reload())
      .catch(() => {
        setHidden((ids) => without(request.id, ids));
        setError(DECLINE_FAILED);
      });
  };

  const decline = (request: ContactRequestView): void => {
    setError(undefined);
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    // A second decline inside Undo commits the earlier one at once instead of losing the call.
    const previous = pendingRef.current;
    if (previous !== undefined) {
      commitDecline(previous);
    }
    hide(request.id);
    setPendingDecline(request);
    pendingRef.current = request;
    timerRef.current = setTimeout(() => commitDecline(request), UNDO_MS);
  };

  const undo = (): void => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
    }
    const request = pendingRef.current;
    pendingRef.current = undefined;
    setPendingDecline(undefined);
    if (request !== undefined) {
      setHidden((ids) => without(request.id, ids));
    }
  };

  const visible = requests.filter((request) => !hidden.has(request.id));
  if (visible.length === 0 && pendingDecline === undefined && error === undefined) {
    return null;
  }
  const shown = visible.slice(0, MAX_ROWS);

  return (
    <View accessibilityRole="none" accessibilityLabel="Contact requests" className="pb-1">
      {shown.map((request) => (
        <RequestRow
          key={request.id}
          request={request}
          busy={busyId === request.id}
          onOpenProfile={() => {
            const handle = request.other.handle;
            if (handle !== null) {
              router.push({ pathname: '/u/[handle]', params: { handle } });
            }
          }}
          onAccept={() => accept(request)}
          onDecline={() => decline(request)}
        />
      ))}
      {visible.length > MAX_ROWS ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`See all ${visible.length} requests`}
          onPress={() => router.push('/settings/requests')}
          className="px-4 py-2 active:bg-surface-raised"
        >
          <Text className="text-[14px] font-medium text-accent">
            See all {visible.length} requests
          </Text>
        </Pressable>
      ) : null}
      {pendingDecline !== undefined ? (
        <View
          accessibilityLiveRegion="polite"
          className="flex-row items-center justify-between gap-3 px-4 py-2"
        >
          <Text className="text-[13px] text-muted-foreground">Declined</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Undo decline" onPress={undo}>
            <Text className="text-[13px] font-medium text-accent">Undo</Text>
          </Pressable>
        </View>
      ) : null}
      {error !== undefined ? (
        <Text accessibilityRole="alert" className="px-4 py-2 text-[13px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function RequestRow({
  request,
  busy,
  onOpenProfile,
  onAccept,
  onDecline,
}: {
  request: ContactRequestView;
  busy: boolean;
  onOpenProfile: () => void;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { name, handle, userId } = request.other;
  const body = (
    <>
      <EntityAvatar person={{ userId, name }} size={52} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[16px] font-semibold text-foreground">
          {name}
        </Text>
        <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
          {handle === null ? 'wants to add you' : `@${handle} wants to add you`}
        </Text>
      </View>
    </>
  );
  return (
    <View className="flex-row items-center gap-2 px-2 py-1.5">
      {handle === null ? (
        <View className="min-w-0 flex-1 flex-row items-center gap-3 px-2 py-1">{body}</View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${name}'s profile`}
          onPress={onOpenProfile}
          className="min-w-0 flex-1 flex-row items-center gap-3 rounded-lg px-2 py-1 active:bg-surface-raised"
        >
          {body}
        </Pressable>
      )}
      <Button
        accessibilityLabel={`Accept ${name}`}
        disabled={busy}
        onPress={onAccept}
        variant="default"
        size="sm"
      >
        <Text>Accept</Text>
      </Button>
      <IconButton label={`Decline ${name}`} disabled={busy} className="h-9 w-9" onPress={onDecline}>
        <X size={18} color={ICON} />
      </IconButton>
    </View>
  );
}
