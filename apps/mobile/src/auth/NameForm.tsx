import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { asColorScheme } from '@/lib/color-scheme';
import { CHAT_BACKGROUND } from '@/lib/colors';

import { safeTarget } from './guard';
import { useAuthStore } from './session';

/** The first sign-in name step; saves through `PATCH /api/me` before continuing. */
export function NameForm() {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const me = useAuthStore((state) => state.me);
  const setName = useAuthStore((state) => state.setName);
  const [name, setNameInput] = useState(me?.name ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Enter your name');
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await setName(trimmed);
    setBusy(false);
    if (!result.ok) {
      setError('Could not save your name. Try again.');
      return;
    }
    // Callers (e.g. the join-by-link page) pass `from` to come back after
    // the name step; the default chains into the handle step, like web.
    const from = safeTarget(params.from);
    if (from !== '/') {
      router.replace(from as Href);
      return;
    }
    router.replace('/welcome/handle' as Href);
  };

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
            onPress={() => void submit()}
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
