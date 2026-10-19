import { Effect } from 'effect';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { AuthCard } from '@/auth/AuthCard';
import { RequireUser } from '@/auth/RequireAuth';
import { safeTarget } from '@/auth/guard';
import { useAuthStore } from '@/auth/session';
import { Button } from '@/components/ui/button';
import { Text, TextField } from '@/components/ui/text';
import { useAction } from '@/lib/effect/use-action';

import { fromThrown } from '@zilar/client-core';
import { useProfileApi } from '@/components/settings/use-profile-api';
import {
  friendlyClaimError,
  handleAvailabilityFor,
  handleAvailabilityText,
  isHandleRateLimited,
  type HandleAvailability,
} from '@/components/settings/profile-logic';
import { suggestHandle } from '@zilar/protocol';

export default function HandleRoute() {
  return (
    <RequireUser>
      <HandleStep />
    </RequireUser>
  );
}

function HandleStep() {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const me = useAuthStore((state) => state.me);
  const { api } = useProfileApi();

  const [handle, setHandle] = useState(() => (me === null ? '' : suggestHandle(me.name, me.email)));
  const [typed, setTyped] = useState(false);
  const [availability, setAvailability] = useState<HandleAvailability>({ state: 'idle' });
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const trimmed = handle.trim();
  // The suggestion fills when the profile arrives after mount while the input is untouched; typing wins forever after.
  if (!typed && handle === '' && me !== null) {
    const suggestion = suggestHandle(me.name, me.email);
    if (suggestion !== '') {
      setHandle(suggestion);
    }
  }

  // Debounced live availability: a newer check, an emptied field or an unmount interrupts it, so a stale answer never replaces the line.
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
    <AuthCard title="Pick your username">
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
    </AuthCard>
  );
}
