import { Effect } from 'effect';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ban, ChevronLeft, UserPlus } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { Button } from '@/components/ui/button';
import { Card, SectionLabel } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { IconTile } from '@/components/ui/icon-tile';
import { ListRow } from '@/components/ui/list-row';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import type { ContactRequestView } from '@/lib/contacts-api';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import {
  performRequestAction,
  requestsLoadFailure,
  type RequestAction,
} from '@/components/contacts/requests';
import { Avatar } from '@/components/chat/avatar';
import { isWaiting, useAction } from '@/lib/effect/use-action';

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
  const { api, mock } = useContactsApi();

  const [incoming, setIncoming] = useState<ContactRequestView[]>([]);
  const [outgoing, setOutgoing] = useState<ContactRequestView[]>([]);
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
            try: () => api.listContactRequests(),
            catch: (loadError: unknown) => requestsLoadFailure(loadError),
          }),
        ),
        Effect.tap((list) =>
          Effect.sync(() => {
            setIncoming(list.incoming);
            setOutgoing(list.outgoing);
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

  const remove = (id: string): void => {
    setIncoming((rows) => rows.filter((row) => row.id !== id));
    setOutgoing((rows) => rows.filter((row) => row.id !== id));
  };

  // One Accept, Decline or Cancel: the row drops on success, a failure keeps it
  // and shows the fixed sentence. The row's own action stops a double tap.
  const act = (id: string, action: RequestAction): Effect.Effect<void> =>
    Effect.sync(() => setError('')).pipe(
      Effect.andThen(Effect.promise(() => performRequestAction(api, id, action, remove))),
      Effect.tap((failure) =>
        Effect.sync(() => {
          if (failure !== null) {
            setError(failure);
          }
        }),
      ),
      Effect.asVoid,
    );

  const pending = incoming.length + outgoing.length;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center gap-1 px-2 py-2">
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={24} color={ICON} />
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
          {status === 'loading' ? <StateMessage kind="loading" title="Loading requests…" /> : null}

          {status === 'error' ? (
            <StateMessage
              kind="error"
              title={error}
              action={{
                label: 'Retry',
                accessibilityLabel: 'Retry loading requests',
                onPress: () => reload(),
              }}
            />
          ) : null}

          {status === 'ready' && pending === 0 ? (
            <View className="items-center gap-3 pt-16">
              <UserPlus size={32} color={ICON} />
              <Text className="px-4 text-center text-[15px] text-muted-foreground">
                No pending requests.
              </Text>
            </View>
          ) : null}

          {status === 'ready' && incoming.length > 0 ? (
            <View accessibilityRole="none" accessibilityLabel="Incoming requests" className="gap-2">
              <SectionLabel>Incoming</SectionLabel>
              <Card>
                {incoming.map((request) => (
                  <RequestRow key={request.id} request={request} onAct={act} />
                ))}
              </Card>
            </View>
          ) : null}

          {status === 'ready' && outgoing.length > 0 ? (
            <View
              accessibilityRole="none"
              accessibilityLabel="Outgoing requests"
              className={incoming.length > 0 ? 'mt-4 gap-2' : 'gap-2'}
            >
              <SectionLabel>Sent</SectionLabel>
              <Card>
                {outgoing.map((request) => (
                  <RequestRow key={request.id} request={request} outgoing onAct={act} />
                ))}
              </Card>
            </View>
          ) : null}

          {error !== '' && status === 'ready' ? (
            <Text accessibilityRole="alert" className="mt-3 text-[14px] text-danger">
              {error}
            </Text>
          ) : null}

          <View className="mt-6">
            <Card>
              <ListRow
                icon={
                  <IconTile>
                    <Ban size={18} color={ICON} />
                  </IconTile>
                }
                title="Blocked people"
                accessibilityLabel="Blocked people"
                onPress={() => router.push('/settings/blocked')}
              />
            </Card>
          </View>
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

function RequestRow({
  request,
  outgoing = false,
  onAct,
}: {
  request: ContactRequestView;
  outgoing?: boolean;
  onAct: (id: string, action: RequestAction) => Effect.Effect<void>;
}) {
  const [state, run] = useAction((action: RequestAction) => onAct(request.id, action));
  const busy = isWaiting(state);
  return (
    <View className="flex-row items-center gap-3 px-3 py-2.5">
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
        <Button
          accessibilityLabel={`Cancel the request to ${request.other.name}`}
          disabled={busy}
          onPress={() => run('cancel')}
          variant="outline"
          size="sm"
        >
          <Text>Cancel</Text>
        </Button>
      ) : (
        <View className="flex-row gap-2">
          <Button
            accessibilityLabel={`Accept ${request.other.name}`}
            disabled={busy}
            onPress={() => run('accept')}
            variant="default"
            size="sm"
          >
            <Text>Accept</Text>
          </Button>
          <Button
            accessibilityLabel={`Decline ${request.other.name}`}
            disabled={busy}
            onPress={() => run('decline')}
            variant="outline"
            size="sm"
          >
            <Text>Decline</Text>
          </Button>
        </View>
      )}
    </View>
  );
}
