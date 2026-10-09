import { Effect, Fiber } from 'effect';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { DirectoryApiError, type GroupVisibility } from '@/lib/directory-api';
import { useAction } from '@/lib/effect/use-action';

/**
 * Visibility helpers (T-0183): the same rules as the web
 * `VisibilitySection`. The owner only may change visibility; everyone else
 * never sees the sheet (the screen gates it on the member role).
 */

/** The owner only may change visibility (same rule as web `GroupPanel`). */
export function mayChangeVisibility(role: string | undefined): boolean {
  return role === 'owner';
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

export function visibilitySaveError(error: unknown): string {
  if (error instanceof DirectoryApiError) {
    switch (error.code) {
      case 'handle_invalid':
        return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
      case 'handle_reserved':
        return 'That handle is reserved. Try another.';
      case 'handle_taken':
        return 'That handle was just taken. Try another.';
      case 'handle_change_too_soon':
        return 'That handle changed recently. Try again later.';
      case 'rate_limited':
        return 'Too many tries — wait a little and try again.';
      case 'not_found':
        return 'That group is no longer available.';
      default:
        break;
    }
    if (error.status === 0 || error.code === 'network_error') {
      return 'Could not reach the server. Check your connection and try again.';
    }
  }
  return 'Could not save the visibility. Try again.';
}

/**
 * The visibility sheet (T-0183): private or public with the @handle and the
 * live availability check. Going private explains that the group disappears
 * from Explore at once while members stay. The screen loads the truth and
 * performs the save; the sheet is the thin view.
 */
export function VisibilitySheet({
  visible,
  groupTitle,
  visibility,
  handle,
  live,
  busy,
  checking,
  check,
  error,
  saved,
  confirmingPrivate,
  share,
  onPick,
  onHandleChange,
  onSave,
  onCancelPrivate,
  onClose,
}: {
  visible: boolean;
  groupTitle: string;
  visibility: GroupVisibility;
  handle: string | null;
  live: { picked: GroupVisibility; typed: string };
  busy: boolean;
  checking: boolean;
  check: { available: boolean; reason?: string | undefined } | null;
  error: string;
  saved: boolean;
  confirmingPrivate: boolean;
  /** Clipboard bridge injected by the screen (`expo-clipboard` can't run in Node tests). */
  share: { copyText: (text: string) => Promise<void> };
  onPick: (next: GroupVisibility) => void;
  onHandleChange: (next: string) => void;
  onSave: () => void;
  onCancelPrivate: () => void;
  onClose: () => void;
}) {
  // `copied` resets when the sheet closes: keyed render state would need the
  // screen to remount the sheet, so the copy button resets on close here.
  // The effect only starts the reset fiber; the fiber applies it once (the
  // lint rule flags synchronous setState inside effects).
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (visible) {
      return;
    }
    const pending = Effect.runFork(
      Effect.sleep(0).pipe(Effect.andThen(Effect.sync(() => setCopied(false)))),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(pending));
    };
  }, [visible]);

  const [, copyText] = useAction(
    (text: string) =>
      Effect.tryPromise({ try: () => share.copyText(text), catch: (cause) => cause }).pipe(
        Effect.tap(() => Effect.sync(() => setCopied(true))),
      ),
    { mode: 'replace' },
  );

  const shareLink =
    handle === null || handle === '' ? null : `zilar://at/${encodeURIComponent(handle)}`;

  const copyShareLink = () => {
    if (shareLink === null) {
      return;
    }
    copyText(shareLink);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close visibility settings"
      title="Visibility"
    >
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
            accessibilityState={{ checked: live.picked === option.value }}
            onPress={() => onPick(option.value)}
            className={`flex-1 items-center rounded-lg border px-3 py-2 active:opacity-80 ${
              live.picked === option.value ? 'border-accent bg-accent/10' : 'border-border-strong'
            }`}
          >
            <Text
              className={`text-[14px] ${
                live.picked === option.value
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground'
              }`}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {live.picked === 'public' ? (
        <>
          <Text className="mt-2 text-[13px] text-muted-foreground">
            Anyone can find and join {groupTitle === '' ? 'this group' : `"${groupTitle}"`}.
          </Text>
          <Text className="mt-2 text-[14px] font-medium text-foreground">Handle</Text>
          <TextField
            value={live.typed}
            onChangeText={onHandleChange}
            maxLength={32}
            editable={!busy}
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
                  @{live.typed.trim()} is available
                </Text>
              ) : (
                <Text accessibilityRole="alert" className="text-[14px] text-danger">
                  {visibilityReasonText(check.reason)}
                </Text>
              )
            ) : null}
          </View>
        </>
      ) : visibility === 'public' ? (
        <Text className="mt-2 text-[13px] text-muted-foreground">
          Going private removes the group from Explore at once. Members stay members, and the old
          handle stays reserved for this group for 30 days.
        </Text>
      ) : null}

      {error !== '' && (
        <Text accessibilityRole="alert" className="mt-2 text-[14px] text-danger">
          {error}
        </Text>
      )}
      {saved && <Text className="mt-2 text-[14px] text-muted-foreground">Saved.</Text>}

      <View className="mt-3 flex-row flex-wrap gap-2 pb-2">
        <Button
          accessibilityLabel={confirmingPrivate ? 'Confirm going private' : 'Save visibility'}
          disabled={busy}
          onPress={onSave}
        >
          <Text>
            {busy ? 'Saving…' : confirmingPrivate ? 'Confirm going private' : 'Save visibility'}
          </Text>
        </Button>
        {confirmingPrivate && (
          <Button
            variant="outline"
            accessibilityLabel="Cancel going private"
            onPress={onCancelPrivate}
          >
            <Text>Cancel</Text>
          </Button>
        )}
        {shareLink !== null && (
          <Button variant="outline" accessibilityLabel="Copy share link" onPress={copyShareLink}>
            <Text>{copied ? 'Copied' : 'Copy share link'}</Text>
          </Button>
        )}
      </View>
    </BottomSheet>
  );
}
