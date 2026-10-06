import { useFocusEffect, useRouter } from 'expo-router';
import { Ban, ChevronLeft, RefreshCw } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';

import { RequireAuth } from '@/auth/RequireAuth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { ICON } from '@/lib/colors';
import type { BlockedPerson } from '@/lib/contacts-api';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { blockedLoadFailure, performUnblock } from '@/components/contacts/blocks';
import { Avatar } from '@/components/chat/avatar';

type PageStatus = 'loading' | 'ready' | 'error';

/**
 * Settings → Blocked people (T-0244, mirrors the web `BlockedPage`): who you
 * blocked, with an Unblock per row. Blocking is silent, so the subtitle says
 * so. Unblocking drops the row; a failure shows one fixed sentence and keeps
 * the row so the user can retry.
 */
export default function BlockedScreen() {
  return (
    <RequireAuth>
      <BlockedList />
    </RequireAuth>
  );
}

function BlockedList() {
  const router = useRouter();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const { api, scenario } = useContactsApi();

  const [people, setPeople] = useState<BlockedPerson[]>([]);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | undefined>(undefined);
  // Guards against a double tap landing before React re-renders the disabled
  // button, so one Unblock can never DELETE twice.
  const busyRef = useRef(false);

  const reload = useCallback(() => {
    setStatus('loading');
    setError('');
    void api
      .listBlockedUsers()
      .then((blocked) => {
        setPeople(blocked);
        setStatus('ready');
      })
      .catch((loadError: unknown) => {
        setError(blockedLoadFailure(loadError));
        setStatus('error');
      });
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const unblock = (userId: string): void => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusyId(userId);
    setError('');
    void performUnblock(api, userId, () => {
      setPeople((rows) => rows.filter((row) => row.userId !== userId));
    })
      .then((failure) => {
        if (failure !== null) {
          setError(failure);
        }
      })
      .finally(() => {
        busyRef.current = false;
        setBusyId(undefined);
      });
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center gap-1 px-2 py-2">
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={24} color={ICON[scheme]} />
        </IconButton>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[20px] font-semibold leading-6 text-foreground">
            Blocked people
          </Text>
          <Text numberOfLines={1} className="mt-0.5 text-[14px] leading-5 text-muted-foreground">
            They are not told.
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
              <Text className="text-[15px] text-muted-foreground">Loading blocked people…</Text>
            </View>
          ) : null}

          {status === 'error' ? (
            <View className="items-center gap-3 pt-12">
              <Text accessibilityRole="alert" className="text-center text-[15px] text-danger">
                {error}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading blocked people"
                onPress={reload}
                className="flex-row items-center gap-2 rounded-full border border-border-strong px-4 py-2 active:bg-surface-raised"
              >
                <RefreshCw size={16} color={ICON[scheme]} />
                <Text className="text-[15px] text-foreground">Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {status === 'ready' && people.length === 0 ? (
            <View className="items-center gap-3 pt-16">
              <Ban size={32} color={ICON[scheme]} />
              <Text className="px-4 text-center text-[15px] text-muted-foreground">
                You have not blocked anyone.
              </Text>
            </View>
          ) : null}

          {status === 'ready' && people.length > 0 ? (
            <View accessibilityRole="none" accessibilityLabel="Blocked people" className="gap-2">
              <Card>
                {people.map((person) => (
                  <BlockedRow
                    key={person.userId}
                    person={person}
                    busy={busyId === person.userId}
                    onUnblock={() => unblock(person.userId)}
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
      {scenario !== null ? (
        <View className="items-center border-t border-divider px-4 py-1">
          <Text className="text-[12px] text-muted-foreground">Mock data</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function BlockedRow({
  person,
  busy,
  onUnblock,
}: {
  person: BlockedPerson;
  busy: boolean;
  onUnblock: () => void;
}) {
  return (
    <View className="flex-row items-center gap-3 px-3 py-2.5">
      <Avatar id={person.userId} name={person.name} size={44} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
          {person.name}
          {person.handle !== null ? (
            <Text className="font-normal text-muted-foreground"> @{person.handle}</Text>
          ) : null}
        </Text>
      </View>
      <Button
        variant="outline"
        size="sm"
        accessibilityLabel={`Unblock ${person.name}`}
        disabled={busy}
        onPress={onUnblock}
      >
        <Text>{busy ? 'Unblocking…' : 'Unblock'}</Text>
      </Button>
    </View>
  );
}
