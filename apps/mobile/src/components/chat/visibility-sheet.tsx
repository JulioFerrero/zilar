import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { DirectoryApiError, type GroupVisibility } from '@/lib/directory-api';
import { sheetBottomPadding, useKeyboardHeight } from '@/lib/use-keyboard-height';

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
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  // `copied` resets when the sheet closes: keyed render state would need the
  // screen to remount the sheet, so the copy button resets on close here.
  // The effect only schedules the reset; the timeout applies it once (the
  // lint rule flags synchronous setState inside effects).
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (visible) {
      return;
    }
    const pending = setTimeout(() => setCopied(false), 0);
    return () => clearTimeout(pending);
  }, [visible]);

  const shareLink =
    handle === null || handle === '' ? null : `zilar://at/${encodeURIComponent(handle)}`;

  const copyShareLink = () => {
    if (shareLink === null) {
      return;
    }
    void share.copyText(shareLink).then(() => setCopied(true));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <Pressable
          accessibilityLabel="Close visibility settings"
          onPress={onClose}
          className="flex-1 justify-end bg-black/40"
        >
          <Pressable
            onPress={() => {}}
            className="max-h-[85%] rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3"
            style={{
              paddingBottom: sheetBottomPadding(Platform.OS, insets.bottom, keyboardHeight),
            }}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <View className="mb-1 h-1 w-10 self-center rounded-full bg-surface-raised" />
              <Text
                accessibilityRole="header"
                className="text-[18px] font-semibold text-foreground"
              >
                Visibility
              </Text>

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
                      live.picked === option.value
                        ? 'border-accent bg-accent/10'
                        : 'border-border-strong'
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
                  Going private removes the group from Explore at once. Members stay members, and
                  the old handle stays reserved for this group for 30 days.
                </Text>
              ) : null}

              {error !== '' && (
                <Text accessibilityRole="alert" className="mt-2 text-[14px] text-danger">
                  {error}
                </Text>
              )}
              {saved && <Text className="mt-2 text-[14px] text-muted-foreground">Saved.</Text>}

              <View className="mt-3 flex-row flex-wrap gap-2 pb-2">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    confirmingPrivate ? 'Confirm going private' : 'Save visibility'
                  }
                  disabled={busy}
                  onPress={onSave}
                  className="items-center rounded-full bg-accent px-4 py-2 active:opacity-90 disabled:opacity-50"
                >
                  <Text className="text-[14px] font-medium text-accent-foreground">
                    {busy
                      ? 'Saving…'
                      : confirmingPrivate
                        ? 'Confirm going private'
                        : 'Save visibility'}
                  </Text>
                </Pressable>
                {confirmingPrivate && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel going private"
                    onPress={onCancelPrivate}
                    className="items-center rounded-full border border-border-strong px-4 py-2 active:bg-surface-raised"
                  >
                    <Text className="text-[14px] text-foreground">Cancel</Text>
                  </Pressable>
                )}
                {shareLink !== null && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Copy share link"
                    onPress={copyShareLink}
                    className="items-center rounded-full border border-border-strong px-4 py-2 active:bg-surface-raised"
                  >
                    <Text className="text-[14px] text-foreground">
                      {copied ? 'Copied' : 'Copy share link'}
                    </Text>
                  </Pressable>
                )}
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
