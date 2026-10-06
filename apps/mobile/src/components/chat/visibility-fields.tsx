import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { DirectoryApiError, type HandleCheck } from '@/lib/directory-api';
import { GroupsApiError } from '@/lib/groups-api';
import { visibilityReasonText } from '@/components/chat/visibility-sheet';

export type CreateVisibility = 'private' | 'public';

export interface HandleCheckState {
  available: boolean;
  reason?: string | undefined;
}

/**
 * The `Private` / `Public` row shared by the New group and New channel
 * sheets (T-0228, the mobile twin of web's `NewGroupDialog` visibility
 * section): Private is invite-only (default), Public asks for an `@handle`
 * with the live availability check. Switching back to Private clears the
 * check; the parent keeps the handle text.
 */
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
            accessibilityState={{ checked: visibility === option.value }}
            onPress={() => onVisibility(option.value)}
            className={`flex-1 items-center rounded-lg border px-3 py-2 active:opacity-80 ${
              visibility === option.value ? 'border-accent bg-accent/10' : 'border-border-strong'
            }`}
          >
            <Text
              className={`text-[14px] ${
                visibility === option.value
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground'
              }`}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text className="mt-2 text-[13px] text-muted-foreground">
        {visibility === 'public'
          ? `Anyone can find and join this ${noun}.`
          : `Only invited people can join this ${noun}.`}
      </Text>
      {visibility === 'public' ? (
        <>
          <Text className="mt-2 text-[14px] font-medium text-foreground">Handle</Text>
          <TextField
            value={handle}
            onChangeText={onHandle}
            maxLength={32}
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
                <Text className="text-[14px] text-muted-foreground">
                  @{handle.trim()} is available
                </Text>
              ) : (
                <Text accessibilityRole="alert" className="text-[14px] text-danger">
                  {visibilityReasonText(check.reason)}
                </Text>
              )
            ) : null}
          </View>
        </>
      ) : null}
    </>
  );
}

/**
 * The debounced live handle check (T-0228): 300 ms after typing stops, like
 * the group screen's visibility effect. `rate_limited` reads unavailable
 * with its reason; other failures clear the result. Late results after
 * unmount are ignored.
 */
export function useHandleCheck(
  visibility: CreateVisibility,
  handle: string,
  check: (value: string) => Promise<HandleCheck>,
): { check: HandleCheckState | null; checking: boolean; reset: () => void } {
  const trimmed = handle.trim();
  const [result, setResult] = useState<HandleCheckState | null>(null);
  const [checking, setChecking] = useState(false);
  // `check` is an inline closure in both sheets, so it stays out of the
  // effect deps (a fresh identity every render would re-run the debounce
  // and re-fire the check in a loop). The ref is written during the effect
  // setup below, never read during render.
  const checkRef = useRef(check);

  useEffect(() => {
    checkRef.current = check;
  });

  useEffect(() => {
    if (visibility !== 'public' || trimmed === '') {
      return;
    }
    let active = true;
    const value = trimmed;
    const pending = setTimeout(() => {
      if (!active) {
        return;
      }
      setChecking(true);
      void checkRef.current(value).then(
        (next) => {
          if (active) {
            setResult(next);
            setChecking(false);
          }
        },
        (error: unknown) => {
          if (!active) {
            return;
          }
          if (error instanceof DirectoryApiError && error.code === 'rate_limited') {
            setResult({ available: false, reason: 'rate_limited' });
          } else {
            setResult(null);
          }
          setChecking(false);
        },
      );
    }, 300);
    return () => {
      active = false;
      clearTimeout(pending);
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

/**
 * The Public Create guards (T-0228, same as web's `create`): an empty
 * handle names the missing handle; a check that said unavailable repeats
 * its reason sentence. Otherwise undefined and Create may go ahead.
 */
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

/**
 * The empty-name and Public-handle guards for the group sheet (T-0228, the
 * same sentences the sheet shows inline). Returns the payload when Create
 * may go ahead, otherwise the sentence to show.
 */
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

/** Merges the selected member ids into the guarded payload. */
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

/**
 * The empty-name and Public-handle guards for the channel sheet (the same
 * sentences the sheet shows inline). Returns the payload when Create may
 * go ahead, otherwise the sentence to show.
 */
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

/** Merges the trimmed description into the guarded payload. */
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

/**
 * Maps a failed public create to a fixed sentence (T-0228, the same codes
 * as `visibilitySaveError`): handle codes name the retry, everything else
 * stays the per-kind fallback. Never server text.
 */
export function createErrorText(error: unknown, kind: 'group' | 'channel'): string {
  const fallback =
    kind === 'group'
      ? 'Could not create the group. Try again.'
      : 'Could not create the channel. Try again.';
  if (error instanceof GroupsApiError) {
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
