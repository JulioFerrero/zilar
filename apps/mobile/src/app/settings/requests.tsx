import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft, RefreshCw, UserPlus } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';

import { RequireAuth } from '@/auth/RequireAuth';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { ICON } from '@/lib/colors';
import type { ContactRequestView } from '@/lib/contacts-api';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { requestsActionFailure, requestsLoadFailure } from '@/components/contacts/requests';
import { Avatar } from '@/components/chat/avatar';

type PageStatus = 'loading' | 'ready' | 'error';

/**
 * Settings → Contact requests (T-0182, mirrors the web `RequestsPage`):
 * incoming requests with Accept / Decline, outgoing with Cancel, the pending
 * count in the subtitle, empty and error states. Accepting surfaces the new
 * contact's DM in the chats list (the server lists every contact's DM), so
 * the accepted row links back to chats.
 */
export default function RequestsScreen() {
  return (
    <RequireAuth>
      <RequestsList />
    </RequireAuth>
  );
}

function RequestsList() {
  const router = useRouter();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const { api, scenario } = useContactsApi();

  const [incoming, setIncoming] = useState<ContactRequestView[]>([]);
  const [outgoing, setOutgoing] = useState<ContactRequestView[]>([]);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | undefined>(undefined);
  // Guards against a double tap landing before React re-renders the disabled
  // button, so one Accept can never POST twice.
  const busyRef = useRef(false);

  const reload = useCallback(() => {
    setStatus('loading');
    setError('');
    void api
      .listContactRequests()
      .then((list) => {
        setIncoming(list.incoming);
        setOutgoing(list.outgoing);
        setStatus('ready');
      })
      .catch((loadError: unknown) => {
        setError(requestsLoadFailure(loadError));
        setStatus('error');
      });
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const remove = (id: string): void => {
    setIncoming((rows) => rows.filter((row) => row.id !== id));
    setOutgoing((rows) => rows.filter((row) => row.id !== id));
  };

  const act = (id: string, action: 'accept' | 'decline' | 'cancel'): void => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusyId(id);
    setError('');
    const work =
      action === 'accept'
        ? api.acceptContactRequest(id)
        : action === 'decline'
          ? api.declineContactRequest(id)
          : api.cancelContactRequest(id);
    void work
      .then(() => {
        remove(id);
      })
      .catch((actionError: unknown) => {
        setError(requestsActionFailure(actionError));
      })
      .finally(() => {
        busyRef.current = false;
        setBusyId(undefined);
      });
  };

  const pending = incoming.length + outgoing.length;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center gap-1 px-2 py-2">
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={24} color={ICON[scheme]} />
        </IconButton>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[20px] font-semibold leading-6 text-foreground">
            Contact requests
          </Text>
          <Text numberOfLines={1} className="mt-0.5 text-[14px] leading-5 text-muted-foreground">
            {status === 'ready'
              ? pending === 0
                ? 'No pending requests.'
                : `${pending} pending`
              : 'People who want to add you.'}
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
          {status === 'loading' ? (
            <View className="items-center gap-3 pt-16">
              <ActivityIndicator />
              <Text className="text-[15px] text-muted-foreground">Loading requests…</Text>
            </View>
          ) : null}

          {status === 'error' ? (
            <View className="items-center gap-3 pt-12">
              <Text accessibilityRole="alert" className="text-center text-[15px] text-danger">
                {error}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading requests"
                onPress={reload}
                className="flex-row items-center gap-2 rounded-full border border-border-strong px-4 py-2 active:bg-surface-raised"
              >
                <RefreshCw size={16} color={ICON[scheme]} />
                <Text className="text-[15px] text-foreground">Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {status === 'ready' && pending === 0 ? (
            <View className="items-center gap-3 pt-16">
              <UserPlus size={32} color={ICON[scheme]} />
              <Text className="px-4 text-center text-[15px] text-muted-foreground">
                No pending requests.
              </Text>
            </View>
          ) : null}

          {status === 'ready' && incoming.length > 0 ? (
            <View accessibilityRole="none" accessibilityLabel="Incoming requests" className="gap-2">
              <Text className="text-[16px] font-semibold text-foreground">Incoming</Text>
              <View className="gap-2">
                {incoming.map((request) => (
                  <RequestRow
                    key={request.id}
                    request={request}
                    busy={busyId === request.id}
                    onAccept={() => act(request.id, 'accept')}
                    onDecline={() => act(request.id, 'decline')}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {status === 'ready' && outgoing.length > 0 ? (
            <View
              accessibilityRole="none"
              accessibilityLabel="Outgoing requests"
              className={incoming.length > 0 ? 'mt-4 gap-2' : 'gap-2'}
            >
              <Text className="text-[16px] font-semibold text-foreground">Sent</Text>
              <View className="gap-2">
                {outgoing.map((request) => (
                  <RequestRow
                    key={request.id}
                    request={request}
                    busy={busyId === request.id}
                    outgoing
                    onCancel={() => act(request.id, 'cancel')}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {error !== '' && status === 'ready' ? (
            <Text accessibilityRole="alert" className="mt-3 text-[14px] text-danger">
              {error}
            </Text>
          ) : null}
        </View>
      </ScrollView>
      {scenario !== null ? (
        <View className="items-center border-t border-divider px-4 py-1">
          <Text className="text-[12px] text-muted-foreground">Mock data</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function RequestRow({
  request,
  busy,
  outgoing = false,
  onAccept,
  onDecline,
  onCancel,
}: {
  request: ContactRequestView;
  busy: boolean;
  outgoing?: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
  onCancel?: () => void;
}) {
  return (
    <View className="flex-row items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Avatar id={request.other.userId} name={request.other.name} size={44} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
          {request.other.name}
          {request.other.handle !== null ? (
            <Text className="font-normal text-muted-foreground"> @{request.other.handle}</Text>
          ) : null}
        </Text>
        {outgoing ? (
          <Text className="text-[13px] text-muted-foreground">Waiting for an answer</Text>
        ) : null}
      </View>
      {outgoing ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Cancel the request to ${request.other.name}`}
          disabled={busy}
          onPress={onCancel}
          className="rounded-full border border-border-strong px-3 py-1 active:bg-surface-raised disabled:opacity-60"
        >
          <Text className="text-[14px] text-foreground">Cancel</Text>
        </Pressable>
      ) : (
        <View className="flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Accept ${request.other.name}`}
            disabled={busy}
            onPress={onAccept}
            className="rounded-full bg-accent px-3 py-1 active:opacity-90 disabled:opacity-60"
          >
            <Text className="text-[14px] font-medium text-accent-foreground">Accept</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Decline ${request.other.name}`}
            disabled={busy}
            onPress={onDecline}
            className="rounded-full border border-border-strong px-3 py-1 active:bg-surface-raised disabled:opacity-60"
          >
            <Text className="text-[14px] text-foreground">Decline</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
