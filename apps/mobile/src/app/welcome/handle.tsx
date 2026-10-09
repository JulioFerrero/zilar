import { Effect } from 'effect';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { RequireUser } from '@/auth/RequireAuth';
import { safeTarget } from '@/auth/guard';
import { useAuthStore } from '@/auth/session';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { asColorScheme } from '@/lib/color-scheme';
import { CHAT_BACKGROUND } from '@/lib/colors';
import { useAction } from '@/lib/effect/use-action';

import { useProfileApi } from '@/components/settings/use-profile-api';
import {
  friendlyClaimError,
  handleAvailabilityFor,
  handleAvailabilityText,
  isHandleRateLimited,
  suggestHandleFor,
  type HandleAvailability,
} from '@/components/settings/profile-logic';

/**
 * Lifts a *-api.ts call into an Effect that fails with the thrown error
 * itself: the handle helpers read its class and code.
 */
function fromThrown<A>(call: () => Promise<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: call, catch: (cause) => cause });
}

export default function HandleRoute() {
  return (
    <RequireUser>
      <HandleStep />
    </RequireUser>
  );
}

/** The post-sign-up handle step: pick a unique `@username`, or skip. */
function HandleStep() {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const me = useAuthStore((state) => state.me);
  const { api } = useProfileApi();

  const [handle, setHandle] = useState(() =>
    me === null ? '' : suggestHandleFor(me.name, me.email),
  );
  const [typed, setTyped] = useState(false);
  const [availability, setAvailability] = useState<HandleAvailability>({ state: 'idle' });
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const trimmed = handle.trim();
  // The suggestion fills when the profile arrives after mount while the
  // input is untouched; typing wins forever after.
  if (!typed && handle === '' && me !== null) {
    const suggestion = suggestHandleFor(me.name, me.email);
    if (suggestion !== '') {
      setHandle(suggestion);
    }
  }

  // Debounced live availability for the typed handle. The check waits before
  // it applies the result once; a newer check, an emptied field or an
  // unmount interrupts it, so a stale answer never replaces the line.
  const [, checkAvailability, checkControls] = useAction(
    (value: string) =>
      Effect.sleep(300).pipe(
        Effect.andThen(fromThrown(() => api.checkHandle(value))),
        Effect.match({
          onSuccess: (result) =>
            handleAvailabilityFor(value, {
              ok: true,
              available: result.available,
              reason: result.reason,
            }),
          onFailure: (checkError) =>
            handleAvailabilityFor(value, {
              ok: false,
              rateLimited: isHandleRateLimited(checkError),
            }),
        }),
        Effect.tap((next) => Effect.sync(() => setAvailability(next))),
      ),
    { mode: 'replace' },
  );

  useEffect(() => {
    if (trimmed === '') {
      return;
    }
    checkAvailability(trimmed);
    return checkControls.interrupt;
  }, [api, trimmed, checkAvailability, checkControls]);

  const target = safeTarget(params.from);
  const [, claim] = useAction((value: string) =>
    fromThrown(() => api.claimHandle(value)).pipe(
      Effect.tap(() => Effect.sync(() => router.replace(target as Href))),
      Effect.tapError((submitError) =>
        Effect.sync(() => {
          setBusy(false);
          setError(friendlyClaimError(submitError));
        }),
      ),
    ),
  );
  const submit = (): void => {
    if (trimmed === '') {
      setError('Choose a username');
      return;
    }
    setBusy(true);
    setError(undefined);
    claim(trimmed);
  };

  const skip = (): void => {
    router.replace(target as Href);
  };

  const line = handleAvailabilityText(availability);
  const unavailable = availability.state === 'unavailable';

  return (
    <View className="flex-1">
      <LinearGradient
        colors={CHAT_BACKGROUND[scheme]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      />
      <SafeAreaView className="flex-1 items-center justify-center p-4">
        <View className="w-full max-w-sm rounded-2xl border border-border-strong bg-surface p-6 shadow-xl">
          <Text className="text-center text-[24px] font-semibold leading-8 text-foreground">
            Pick your username
          </Text>
          <Text className="mt-1 text-center text-[15px] text-muted-foreground">
            Friends add you with it, like @ada. You can change it later.
          </Text>
          <Text className="mt-6 text-[14px] font-medium text-foreground">Username</Text>
          <TextField
            accessibilityLabel="Username"
            autoFocus
            maxLength={32}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            editable={!busy}
            value={handle}
            onChangeText={(value) => {
              setHandle(value);
              setTyped(true);
            }}
            placeholder="ada_lovelace"
            className="mt-1"
          />
          <View accessibilityLiveRegion="polite" className="mt-2 min-h-[20px]">
            {line !== null ? (
              <Text
                className={
                  unavailable ? 'text-[14px] text-danger' : 'text-[14px] text-muted-foreground'
                }
              >
                {line}
              </Text>
            ) : null}
          </View>
          {error !== undefined ? (
            <Text accessibilityRole="alert" className="mt-2 text-[14px] text-danger">
              {error}
            </Text>
          ) : null}
          <Button
            accessibilityLabel="Continue"
            disabled={busy}
            onPress={submit}
            variant="default"
            size="lg"
            className="mt-4"
          >
            <Text>Continue</Text>
          </Button>
          <Button
            accessibilityLabel="Skip for now"
            disabled={busy}
            onPress={skip}
            variant="ghost"
            size="default"
            className="mt-2"
          >
            <Text>Skip for now</Text>
          </Button>
        </View>
      </SafeAreaView>
    </View>
  );
}
