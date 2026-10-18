import { Effect } from 'effect';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';

import { AuthCard } from './AuthCard';
import { errorMessageFor, isEmailValid } from './errors';
import { InviteCodeField } from './InviteCodeField';
import { OtpInput } from './OtpInput';
import { requestSignInCode, useAuthStore } from './session';
import { safeTarget } from './guard';
import type { AuthError, SignInOutcome } from './session-store';

export const RESEND_SECONDS = 30;

const RESEND_INTERVAL_MS = 1000;

/**
 * Shared email → code flow for the invite and login screens. The invite field
 * appears only once the server says the email has no account.
 */
export function AuthFlow({
  inviteCode: inviteCodeProp,
  heading,
  subheading,
}: {
  inviteCode?: string;
  heading: string;
  subheading?: string;
}) {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const signIn = useAuthStore((state) => state.signIn);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [inviteCode, setInviteCode] = useState(inviteCodeProp ?? '');
  const [inviteStep, setInviteStep] = useState(false);
  const [inviteHint, setInviteHint] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // The invite a request carries: none before the server asks for one, then the
  // trimmed field value (or none when the field is empty).
  const requestInvite = (): string | undefined => {
    if (!inviteStep) {
      return undefined;
    }
    const trimmed = inviteCode.trim();
    return trimmed === '' ? undefined : trimmed;
  };

  // The resend countdown: one sleep per second left, interrupted when the
  // count changes or the screen goes away.
  useQuery(
    () =>
      secondsLeft <= 0
        ? Effect.void
        : Effect.sleep(RESEND_INTERVAL_MS).pipe(
            Effect.andThen(Effect.sync(() => setSecondsLeft((value) => Math.max(0, value - 1)))),
          ),
    [secondsLeft],
  );

  // A call that rejects counts as a failed call with the generic message.
  const [requestState, sendCode] = useAction<void, void, never>(() =>
    Effect.gen(function* () {
      setError(undefined);
      const result = yield* Effect.tryPromise({
        try: () => requestSignInCode(email.trim(), requestInvite()),
        catch: (cause) => cause,
      }).pipe(Effect.orElseSucceed((): { error?: AuthError } => ({ error: {} })));
      if (result.error !== undefined) {
        if (result.error.code === 'invite_required') {
          setInviteStep(true);
          setInviteHint(errorMessageFor(result.error));
          return;
        }
        setError(errorMessageFor(result.error));
        return;
      }
      setCode('');
      setStep('code');
      setSecondsLeft(RESEND_SECONDS);
    }),
  );

  const [verifyState, sendVerify] = useAction((value: string) =>
    Effect.gen(function* () {
      setError(undefined);
      const outcome = yield* Effect.tryPromise({
        try: () => signIn({ email: email.trim(), otp: value, inviteCode: requestInvite() }),
        catch: (cause) => cause,
      }).pipe(Effect.orElseSucceed((): SignInOutcome => ({ ok: false, error: {} })));
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
    }),
  );

  const busy = isWaiting(requestState) || isWaiting(verifyState);

  const changeEmail = (value: string): void => {
    setEmail(value);
    setInviteStep(false);
    setError(undefined);
    setInviteHint(undefined);
  };

  const submitEmail = (): void => {
    if (!isEmailValid(email)) {
      setError('Enter a valid email address');
      return;
    }
    sendCode();
  };

  const verify = (value: string): void => {
    if (busy || value.length !== 6) {
      return;
    }
    sendVerify(value);
  };

  return (
    <AuthCard title={heading}>
      {subheading !== undefined && (
        <Text className="mt-1 text-center text-[15px] text-muted-foreground">{subheading}</Text>
      )}

      {step === 'email' ? (
        <View className="mt-6 gap-3">
          <Text className="text-[14px] font-medium text-foreground">Email</Text>
          <TextField
            accessibilityLabel="Email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            autoFocus
            returnKeyType="go"
            editable={!busy}
            value={email}
            onChangeText={changeEmail}
            onSubmitEditing={submitEmail}
            placeholder="you@example.com"
          />
          {inviteStep === false && error !== undefined && (
            <Text accessibilityRole="alert" className="text-[14px] text-danger">
              {error}
            </Text>
          )}
          {inviteStep && inviteHint !== undefined && (
            <Text className="text-[14px] text-muted-foreground">{inviteHint}</Text>
          )}
          {inviteStep && <InviteCodeField value={inviteCode} onChange={setInviteCode} />}
          {inviteStep && error !== undefined && (
            <Text accessibilityRole="alert" className="text-[14px] text-danger">
              {error}
            </Text>
          )}
          <Button
            accessibilityLabel="Continue"
            disabled={busy}
            onPress={submitEmail}
            variant="default"
            size="lg"
            className="mt-1"
          >
            <Text>Continue</Text>
          </Button>
        </View>
      ) : (
        <View className="mt-6 items-center gap-4">
          <Text className="text-center text-[15px] text-muted-foreground">
            Enter the 6-digit code we sent to <Text className="text-foreground">{email}</Text>
          </Text>
          <OtpInput
            value={code}
            onChange={setCode}
            onComplete={verify}
            disabled={busy}
            invalid={error !== undefined}
          />
          {error !== undefined && (
            <Text accessibilityRole="alert" className="text-[14px] text-danger">
              {error}
            </Text>
          )}
          <View className="flex-row items-center gap-3">
            <Button
              accessibilityLabel="Continue"
              disabled={busy}
              onPress={() => verify(code)}
              variant="default"
              size="default"
            >
              <Text>Continue</Text>
            </Button>
            {secondsLeft > 0 ? (
              <Text className="text-[14px] text-muted-foreground">Resend in {secondsLeft}s</Text>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="px-0"
                accessibilityLabel="Resend code"
                disabled={busy}
                onPress={() => sendCode()}
              >
                <Text className="text-[14px] text-accent">Resend code</Text>
              </Button>
            )}
          </View>
          <Button
            variant="link"
            size="sm"
            className="px-0"
            accessibilityLabel="Use a different email"
            onPress={() => {
              setStep('email');
              setError(undefined);
            }}
          >
            <Text className="text-[14px] text-muted-foreground">Use a different email</Text>
          </Button>
        </View>
      )}
    </AuthCard>
  );
}
