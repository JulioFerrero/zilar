import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { RequireUser } from '@/auth/RequireAuth';
import { safeTarget } from '@/auth/guard';
import { useAuthStore } from '@/auth/session';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { asColorScheme } from '@/lib/color-scheme';
import { CHAT_BACKGROUND } from '@/lib/colors';

import { useProfileApi } from '@/components/settings/use-profile-api';
import {
  friendlyClaimError,
  handleAvailabilityFor,
  handleAvailabilityText,
  isHandleRateLimited,
  suggestHandleFor,
  type HandleAvailability,
} from '@/components/settings/profile-logic';

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

  // Debounced live availability for the typed handle. The effect only
  // schedules the check; the timeout callback applies the result once.
  useEffect(() => {
    if (trimmed === '') {
      return;
    }
    let active = true;
    const value = trimmed;
    const pending = setTimeout(() => {
      void api.checkHandle(value).then(
        (result) => {
          if (active) {
            setAvailability(
              handleAvailabilityFor(value, {
                ok: true,
                available: result.available,
                reason: result.reason,
              }),
            );
          }
        },
        (checkError: unknown) => {
          if (!active) return;
          if (isHandleRateLimited(checkError)) {
            setAvailability(handleAvailabilityFor(value, { ok: false, rateLimited: true }));
            return;
          }
          setAvailability(handleAvailabilityFor(value, { ok: false, rateLimited: false }));
        },
      );
    }, 300);
    return () => {
      active = false;
      clearTimeout(pending);
    };
  }, [api, trimmed]);

  const target = safeTarget(params.from);
  const submit = (): void => {
    if (trimmed === '') {
      setError('Choose a username');
      return;
    }
    setBusy(true);
    setError(undefined);
    void api
      .claimHandle(trimmed)
      .then(() => {
        router.replace(target as Href);
      })
      .catch((submitError: unknown) => {
        setBusy(false);
        setError(friendlyClaimError(submitError));
      });
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue"
            disabled={busy}
            onPress={submit}
            className="mt-4 items-center rounded-full bg-accent px-4 py-3 active:bg-accent/90 disabled:opacity-60"
          >
            <Text className="text-[15px] font-medium text-accent-foreground">Continue</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip for now"
            disabled={busy}
            onPress={skip}
            className="mt-2 items-center rounded-full px-4 py-2 active:opacity-70 disabled:opacity-60"
          >
            <Text className="text-[15px] text-muted-foreground">Skip for now</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
