import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { CHAT_BACKGROUND } from '@/lib/colors';

import { errorMessageFor, isEmailValid } from './errors';
import { OtpInput } from './OtpInput';
import { requestSignInCode, useAuthStore } from './session';
import { safeTarget } from './guard';

export const RESEND_SECONDS = 30;

const RESEND_INTERVAL_MS = 1000;

/** Shared email → code flow for the invite and login screens. */
export function AuthFlow({
  inviteCode,
  heading,
  subheading,
}: {
  inviteCode?: string;
  heading: string;
  subheading?: string;
}) {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const signIn = useAuthStore((state) => state.signIn);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setSecondsLeft((value) => Math.max(0, value - 1));
    }, RESEND_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const requestCode = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    const result = await requestSignInCode(email.trim(), inviteCode);
    setBusy(false);
    if (result.error !== undefined) {
      setError(errorMessageFor(result.error));
      return;
    }
    setCode('');
    setStep('code');
    setSecondsLeft(RESEND_SECONDS);
  };

  const submitEmail = (): void => {
    if (!isEmailValid(email)) {
      setError('Enter a valid email address');
      return;
    }
    void requestCode();
  };

  const verify = async (value: string): Promise<void> => {
    if (busy || value.length !== 6) {
      return;
    }
    setBusy(true);
    setError(undefined);
    const outcome = await signIn({ email: email.trim(), otp: value, inviteCode });
    setBusy(false);
    if (!outcome.ok) {
      setError(errorMessageFor(outcome.error));
      setCode('');
      return;
    }

    const target = safeTarget(params.from);
    if (outcome.me.name.trim() === '') {
      router.replace(`/welcome/name?from=${encodeURIComponent(target)}`);
      return;
    }
    // `target` starts with `/`; `safeTarget` guarantees it before the cast.
    router.replace(target as Href);
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
            {heading}
          </Text>
          {subheading !== undefined && (
            <Text className="mt-1 text-center text-[15px] text-muted-foreground">{subheading}</Text>
          )}

          {step === 'email' ? (
            <View className="mt-6 gap-3">
              <Text className="text-[14px] font-medium text-foreground">Email</Text>
              <TextInput
                accessibilityLabel="Email"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                autoFocus
                returnKeyType="go"
                editable={!busy}
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={submitEmail}
                placeholder="you@example.com"
                placeholderTextColor="#a1a1a1"
                className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] text-foreground"
              />
              {error !== undefined && (
                <Text accessibilityRole="alert" className="text-[14px] text-danger">
                  {error}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Continue"
                disabled={busy}
                onPress={submitEmail}
                className="mt-1 items-center rounded-full bg-accent px-4 py-3 active:bg-accent/90"
              >
                <Text className="text-[15px] font-medium text-accent-foreground">Continue</Text>
              </Pressable>
            </View>
          ) : (
            <View className="mt-6 items-center gap-4">
              <Text className="text-center text-[15px] text-muted-foreground">
                Enter the 6-digit code we sent to <Text className="text-foreground">{email}</Text>
              </Text>
              <OtpInput
                value={code}
                onChange={setCode}
                onComplete={(value) => void verify(value)}
                disabled={busy}
                invalid={error !== undefined}
              />
              {error !== undefined && (
                <Text accessibilityRole="alert" className="text-[14px] text-danger">
                  {error}
                </Text>
              )}
              <View className="flex-row items-center gap-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Continue"
                  disabled={busy}
                  onPress={() => void verify(code)}
                  className="rounded-full bg-accent px-5 py-2.5 active:bg-accent/90"
                >
                  <Text className="text-[15px] font-medium text-accent-foreground">Continue</Text>
                </Pressable>
                {secondsLeft > 0 ? (
                  <Text className="text-[14px] text-muted-foreground">
                    Resend in {secondsLeft}s
                  </Text>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Resend code"
                    disabled={busy}
                    onPress={() => void requestCode()}
                  >
                    <Text className="text-[14px] text-accent">Resend code</Text>
                  </Pressable>
                )}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Use a different email"
                onPress={() => {
                  setStep('email');
                  setError(undefined);
                }}
              >
                <Text className="text-[14px] text-muted-foreground">Use a different email</Text>
              </Pressable>
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
