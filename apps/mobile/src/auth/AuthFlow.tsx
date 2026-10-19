import { Effect } from 'effect';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState, useEffect, useRef } from 'react';
import { View, TextInput } from 'react-native';
import { parseInviteCode } from '@zilar/chat-core';

import { Button } from '@/components/ui/button';
import { Text, TextField } from '@/components/ui/text';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { cn } from '@/lib/utils';

import { AuthCard } from './AuthCard';
import { requestSignInCode, useAuthStore } from './session';
import { safeTarget } from './guard';
import type { AuthError, SignInOutcome } from './session-store';
import { OTP_LENGTH, applyOtpBackspace, applyOtpText, isOtpComplete, otpValue } from './otp';

function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  label = 'Verification code',
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  label?: string;
}) {
  const refs = useRef<Array<TextInput | null>>([]);
  const digits = value.padEnd(OTP_LENGTH, ' ').slice(0, OTP_LENGTH).split('');
  const completedRef = useRef(false);

  useEffect(() => {
    completedRef.current = false;
  }, [value]);

  const focus = (index: number): void => {
    refs.current[index]?.focus();
  };

  const commit = (next: string, focusIndex: number): void => {
    onChange(next);
    focus(focusIndex);
    if (isOtpComplete(next) && !completedRef.current) {
      completedRef.current = true;
      onComplete?.(next);
    }
  };

  const handleChange = (index: number, text: string): void => {
    const state = applyOtpText(digits, index, text);
    commit(otpValue(state.digits), state.focusIndex);
  };

  const handleKeyPress = (index: number, key: string): void => {
    if (key !== 'Backspace' || digits[index]?.trim() !== '') {
      return;
    }
    const state = applyOtpBackspace(digits, index);
    commit(otpValue(state.digits), state.focusIndex);
  };

  return (
    <View accessibilityRole="none" accessibilityLabel={label} className="flex-row justify-center">
      {digits.map((digit, index) => (
        <TextInput
          // Position is the stable identity of each box.
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          value={digit.trim()}
          editable={disabled !== true}
          autoFocus={index === 0}
          maxLength={OTP_LENGTH}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          accessibilityLabel={`Digit ${index + 1}`}
          accessibilityState={{ disabled: disabled === true }}
          onChangeText={(text) => handleChange(index, text)}
          onKeyPress={(event) => handleKeyPress(index, event.nativeEvent.key)}
          className={cn(
            'mx-1 h-11 w-11 rounded-lg border border-input bg-background text-center text-[20px] font-semibold text-foreground',
            invalid === true && 'border-danger',
            disabled === true && 'opacity-50',
          )}
        />
      ))}
    </View>
  );
}

function InviteCodeField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextField
      label="Invite code"
      accessibilityLabel="Invite code"
      autoCapitalize="none"
      autoComplete="off"
      autoCorrect={false}
      spellCheck={false}
      value={value}
      onChangeText={(text) => onChange(parseInviteCode(text))}
      placeholder="Paste your invite code or link"
    />
  );
}

/** Mirrors the web copy for the errors the server can return. */
function errorMessageFor(error: AuthError | undefined): string {
  const code = error?.code ?? '';
  if (code === 'invite_required') {
    return 'This email has no account yet. Enter your invite code to sign up.';
  }
  if (code === 'invite_invalid') {
    return 'This invite code is invalid, expired or already used.';
  }
  if (code === 'TOO_MANY_ATTEMPTS' || error?.status === 429) {
    return 'Too many attempts, try again later';
  }
  if (code === 'INVALID_OTP' || code === 'OTP_EXPIRED') {
    return 'Wrong code';
  }
  if (code === 'MISSING_OR_NULL_ORIGIN' || code === 'INVALID_ORIGIN') {
    return 'Sign-in was blocked. Close the app and try again.';
  }
  return 'Something went wrong. Try again.';
}

function isEmailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export const RESEND_SECONDS = 30;

const RESEND_INTERVAL_MS = 1000;

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

  const requestInvite = (): string | undefined => {
    if (!inviteStep) {
      return undefined;
    }
    const trimmed = inviteCode.trim();
    return trimmed === '' ? undefined : trimmed;
  };

  useQuery(
    () =>
      secondsLeft <= 0
        ? Effect.void
        : Effect.sleep(RESEND_INTERVAL_MS).pipe(
            Effect.andThen(Effect.sync(() => setSecondsLeft((value) => Math.max(0, value - 1)))),
          ),
    [secondsLeft],
  );

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
