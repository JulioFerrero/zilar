import { ApiError, type HandleCheck } from '@zilar/api-contract';
import { Effect } from 'effect';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text, TextField } from '@/components/ui/text';
import { interruptFiber } from '@zilar/client-core';

export type CreateVisibility = 'private' | 'public';

export interface HandleCheckState {
  available: boolean;
  reason?: string | undefined;
}

export function visibilityReasonText(reason: string | undefined): string {
  switch (reason) {
    case 'invalid':
      return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
    case 'reserved':
      return 'That handle is reserved. Try another.';
    case 'rate_limited':
      return 'Too many checks — wait a little and try again.';
    default:
      return 'That handle is taken. Try another.';
  }
}

export function VisibilityChoice({
  value,
  onChange,
}: {
  value: CreateVisibility;
  onChange: (next: CreateVisibility) => void;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Visibility"
      className="mt-3 flex-row gap-2"
    >
      {(
        [
          { value: 'private', label: 'Private' },
          { value: 'public', label: 'Public' },
        ] as const
      ).map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          accessibilityLabel={option.label}
          accessibilityState={{ checked: value === option.value }}
          onPress={() => onChange(option.value)}
          className={`flex-1 items-center rounded-lg border px-3 py-2 active:opacity-80 ${
            value === option.value ? 'border-accent bg-accent/10' : 'border-border-strong'
          }`}
        >
          <Text
            className={`text-[14px] ${
              value === option.value ? 'font-medium text-foreground' : 'text-muted-foreground'
            }`}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function HandleCheckField({
  handle,
  onChange,
  check,
  checking,
  editable,
}: {
  handle: string;
  onChange: (next: string) => void;
  check: HandleCheckState | null;
  checking: boolean;
  editable?: boolean | undefined;
}) {
  return (
    <>
      <Text className="mt-2 text-[14px] font-medium text-foreground">Handle</Text>
      <TextField
        value={handle}
        onChangeText={onChange}
        maxLength={32}
        editable={editable}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="hiking_club"
        accessibilityLabel="Group handle"
        className="mt-1"
      />
      <View className="min-h-[20px]">
        {checking ? (
          <Text className="text-[14px] text-muted-foreground">Checking…</Text>
        ) : check !== null ? (
          check.available ? (
            <Text className="text-[14px] text-muted-foreground">@{handle.trim()} is available</Text>
          ) : (
            <Text accessibilityRole="alert" className="text-[14px] text-danger">
              {visibilityReasonText(check.reason)}
            </Text>
          )
        ) : null}
      </View>
    </>
  );
}

// Private is invite-only (default); Public asks for an `@handle` with a live availability check. Switching back to Private clears the check; the parent keeps the handle text.
export function VisibilityFields({
  kind,
  visibility,
  onVisibility,
  handle,
  onHandle,
  check,
  checking,
}: {
  kind: 'group' | 'channel';
  visibility: CreateVisibility;
  onVisibility: (next: CreateVisibility) => void;
  handle: string;
  onHandle: (next: string) => void;
  check: HandleCheckState | null;
  checking: boolean;
}) {
  const noun = kind === 'group' ? 'group' : 'channel';
  return (
    <>
      <VisibilityChoice value={visibility} onChange={onVisibility} />
      <Text className="mt-2 text-[13px] text-muted-foreground">
        {visibility === 'public'
          ? `Anyone can find and join this ${noun}.`
          : `Only invited people can join this ${noun}.`}
      </Text>
      {visibility === 'public' ? (
        <HandleCheckField handle={handle} onChange={onHandle} check={check} checking={checking} />
      ) : null}
    </>
  );
}

// Debounced live handle check, 300 ms after typing stops. `rate_limited` reads unavailable with its reason; other failures clear the result; late results after unmount are ignored.
export function useHandleCheck(
  visibility: CreateVisibility,
  handle: string,
  check: (value: string) => Promise<HandleCheck>,
): { check: HandleCheckState | null; checking: boolean; reset: () => void } {
  const trimmed = handle.trim();
  const [result, setResult] = useState<HandleCheckState | null>(null);
  const [checking, setChecking] = useState(false);
  // `check` is an inline closure in both sheets, so it stays out of the deps: a fresh identity would re-run the debounce in a loop.
  const checkRef = useRef(check);

  useEffect(() => {
    checkRef.current = check;
  });

  useEffect(() => {
    if (visibility !== 'public' || trimmed === '') {
      return;
    }
    // Debounce and check run in one fiber; the cleanup interrupts it, so a late answer is never applied.
    const pending = Effect.runFork(
      Effect.sleep(300).pipe(
        Effect.andThen(Effect.sync(() => setChecking(true))),
        Effect.andThen(
          Effect.tryPromise({
            try: () => checkRef.current(trimmed),
            catch: (error) => error,
          }).pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                Effect.sync(() => {
                  if (error instanceof ApiError && error.code === 'rate_limited') {
                    setResult({ available: false, reason: 'rate_limited' });
                  } else {
                    setResult(null);
                  }
                  setChecking(false);
                }),
              onSuccess: (next) =>
                Effect.sync(() => {
                  setResult(next);
                  setChecking(false);
                }),
            }),
          ),
        ),
      ),
    );
    return () => {
      interruptFiber(pending);
    };
  }, [visibility, trimmed]);

  return {
    check: result,
    checking,
    reset: () => {
      setResult(null);
    },
  };
}

// Public Create guards: an empty handle names the missing one; an unavailable check repeats its reason sentence.
export function publicCreateError(
  visibility: CreateVisibility,
  handle: string,
  check: HandleCheckState | null,
  kind: 'group' | 'channel',
): string | undefined {
  if (visibility !== 'public') {
    return undefined;
  }
  if (handle.trim() === '') {
    return kind === 'group'
      ? 'Choose a handle for the public group.'
      : 'Choose a handle for the public channel.';
  }
  if (check !== null && !check.available) {
    return visibilityReasonText(check.reason);
  }
  return undefined;
}

// Empty-name and Public-handle guards; returns the payload or the sentence to show.
export function groupCreateGuard(
  title: string,
  visibility: CreateVisibility,
  handle: string,
  check: HandleCheckState | null,
):
  | { input: { title: string; visibility: 'public'; handle: string } | { title: string } }
  | { error: string } {
  const trimmed = title.trim();
  if (trimmed === '') {
    return { error: 'Enter a group name' };
  }
  const guard = publicCreateError(visibility, handle, check, 'group');
  if (guard !== undefined) {
    return { error: guard };
  }
  return {
    input:
      visibility === 'public'
        ? { title: trimmed, visibility: 'public' as const, handle: handle.trim() }
        : { title: trimmed },
  };
}

export function buildGroupCreateInput(
  title: string,
  selected: string[],
  visibility: CreateVisibility,
  handle: string,
  check: HandleCheckState | null,
):
  | { input: { title: string; memberIds: string[]; visibility?: 'public'; handle?: string } }
  | { error: string } {
  const guard = groupCreateGuard(title, visibility, handle, check);
  if ('error' in guard) {
    return guard;
  }
  return { input: { ...guard.input, memberIds: selected } };
}

// The channel sheet's empty-name and Public-handle guards.
export function channelCreateGuard(
  title: string,
  visibility: CreateVisibility,
  handle: string,
  check: HandleCheckState | null,
):
  | { input: { title: string; visibility: 'public'; handle: string } | { title: string } }
  | { error: string } {
  const trimmed = title.trim();
  if (trimmed === '') {
    return { error: 'Enter a channel name' };
  }
  const guard = publicCreateError(visibility, handle, check, 'channel');
  if (guard !== undefined) {
    return { error: guard };
  }
  return {
    input:
      visibility === 'public'
        ? { title: trimmed, visibility: 'public' as const, handle: handle.trim() }
        : { title: trimmed },
  };
}

export function buildChannelCreateInput(
  title: string,
  description: string,
  visibility: CreateVisibility,
  handle: string,
  check: HandleCheckState | null,
):
  | { input: { title: string; description?: string; visibility?: 'public'; handle?: string } }
  | { error: string } {
  const guard = channelCreateGuard(title, visibility, handle, check);
  if ('error' in guard) {
    return guard;
  }
  const clean = description.trim();
  return {
    input: {
      ...guard.input,
      ...(clean === '' ? {} : { description: clean }),
    },
  };
}

// Maps a failed public create to a fixed sentence by code; never server text.
export function createErrorText(error: unknown, kind: 'group' | 'channel'): string {
  const fallback =
    kind === 'group'
      ? 'Could not create the group. Try again.'
      : 'Could not create the channel. Try again.';
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'handle_invalid':
        return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
      case 'handle_reserved':
        return 'That handle is reserved. Try another.';
      case 'handle_taken':
        return 'That handle was just taken. Try another.';
      case 'rate_limited':
        return 'Too many tries — wait a little and try again.';
      default:
        break;
    }
  }
  return fallback;
}
