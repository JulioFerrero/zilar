import { Effect } from 'effect';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { CHAT_BACKGROUND } from '@/lib/colors';
import { isWaiting, useAction } from '@/lib/effect/use-action';

import { safeTarget } from './guard';
import { useAuthStore } from './session';

/** The first sign-in name step; saves through `PATCH /api/me` before continuing. */
export function NameForm() {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const me = useAuthStore((state) => state.me);
  const setName = useAuthStore((state) => state.setName);
  const [name, setNameInput] = useState(me?.name ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [saveState, save] = useAction((trimmed: string) =>
    Effect.gen(function* () {
      setError(undefined);
      // A rejected save is a failed save, shown with the same sentence.
      const result = yield* Effect.tryPromise({
        try: () => setName(trimmed),
        catch: (cause) => cause,
      }).pipe(Effect.orElseSucceed(() => ({ ok: false })));
      if (!result.ok) {
        setError('Could not save your name. Try again.');
        return;
      }
      // Callers (e.g. the join-by-link page) pass `from` to come back after
      // the name step; the default chains into the handle step, like web.
      const from = safeTarget(params.from);
      router.replace(from !== '/' ? (from as Href) : ('/welcome/handle' as Href));
    }),
  );
  const busy = isWaiting(saveState);

  const submit = (): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Enter your name');
      return;
    }
    save(trimmed);
  };

  return (
    <View className="flex-1">
      <LinearGradient
        colors={CHAT_BACKGROUND}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      />
      <SafeAreaView className="flex-1 items-center justify-center p-4">
        <View className="w-full max-w-sm rounded-2xl border border-border-strong bg-surface p-6 shadow-xl">
          <Text className="text-center text-[24px] font-semibold leading-8 text-foreground">
            What should we call you?
          </Text>
          <Text className="mt-1 text-center text-[15px] text-muted-foreground">
            Your friends will see this name.
          </Text>
          <Text className="mt-6 text-[14px] font-medium text-foreground">Name</Text>
          <TextField
            accessibilityLabel="Name"
            autoFocus
            maxLength={64}
            editable={!busy}
            value={name}
            onChangeText={setNameInput}
            placeholder="Your name"
            className="mt-1"
          />
          {error !== undefined && (
            <Text accessibilityRole="alert" className="mt-2 text-[14px] text-danger">
              {error}
            </Text>
          )}
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
        </View>
      </SafeAreaView>
    </View>
  );
}
