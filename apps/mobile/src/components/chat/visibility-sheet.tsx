import { ApiError } from '@zilar/api-contract';
import { handleSaveMessage } from '@zilar/chat-core';
import { Effect } from 'effect';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { HandleCheckField, VisibilityChoice } from '@/components/chat/visibility-fields';
import type { GroupVisibility } from '@/lib/directory-api';
import type { useGroupVisibility } from '@/components/chat/use-group-visibility';
import { interruptFiber } from '@zilar/client-core';
import { useAction } from '@/lib/effect/use-action';

// The same rules as web's `VisibilitySection`: only the owner may change visibility; everyone else never sees the sheet.

/** The owner only may change visibility (same rule as web `GroupPanel`). */
export function mayChangeVisibility(role: string | undefined): boolean {
  return role === 'owner';
}

export function visibilitySaveError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'not_found') {
      return 'That group is no longer available.';
    }
    if (error.status === 0 || error.code === 'network_error') {
      return 'Could not reach the server. Check your connection and try again.';
    }
    const next = error.detail.nextChangeAt;
    const message = handleSaveMessage(
      {
        code: error.code,
        message: error.message,
        nextChangeAt: typeof next === 'string' ? next : undefined,
      },
      'handle',
    );
    if (message !== undefined) {
      return message;
    }
  }
  return 'Could not save the visibility. Try again.';
}

// The visibility sheet: private or public with the @handle and a live availability check. Going private explains that the group leaves Explore at once while members stay. The screen loads and saves; the sheet is a thin view.
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
  share: { copyText: (text: string) => Promise<void> };
  onPick: (next: GroupVisibility) => void;
  onHandleChange: (next: string) => void;
  onSave: () => void;
  onCancelPrivate: () => void;
  onClose: () => void;
}) {
  // `copied` resets when the sheet closes; the effect only starts the reset fiber (lint flags synchronous setState in effects).
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (visible) {
      return;
    }
    const pending = Effect.runFork(
      Effect.sleep(0).pipe(Effect.andThen(Effect.sync(() => setCopied(false)))),
    );
    return () => {
      interruptFiber(pending);
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
      onBack={confirmingPrivate ? onCancelPrivate : undefined}
      footer={
        <Button
          accessibilityLabel={confirmingPrivate ? 'Confirm going private' : 'Save visibility'}
          disabled={busy}
          onPress={onSave}
        >
          <Text>
            {busy ? 'Saving…' : confirmingPrivate ? 'Confirm going private' : 'Save visibility'}
          </Text>
        </Button>
      }
    >
      <VisibilityChoice value={live.picked} onChange={onPick} />

      {live.picked === 'public' ? (
        <>
          <Text className="mt-2 text-[13px] text-muted-foreground">
            Anyone can find and join {groupTitle === '' ? 'this group' : `"${groupTitle}"`}.
          </Text>
          <HandleCheckField
            handle={live.typed}
            onChange={onHandleChange}
            check={check}
            checking={checking}
            editable={!busy}
          />
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

      {shareLink !== null && (
        <View className="mt-3 flex-row flex-wrap gap-2 pb-2">
          <Button variant="outline" accessibilityLabel="Copy share link" onPress={copyShareLink}>
            <Text>{copied ? 'Copied' : 'Copy share link'}</Text>
          </Button>
        </View>
      )}
    </BottomSheet>
  );
}

export type VisibilitySheetState = ReturnType<typeof useGroupVisibility>;

// The group and channel screens both bind the same hook state to the one sheet.
export function GroupVisibilitySheet({
  state,
  groupTitle,
  share,
}: {
  state: VisibilitySheetState;
  groupTitle: string;
  share: { copyText: (text: string) => Promise<void> };
}) {
  return (
    <VisibilitySheet
      visible={state.visible}
      groupTitle={groupTitle}
      visibility={state.truth?.visibility ?? 'private'}
      handle={state.truth?.handle ?? null}
      live={{ picked: state.picked, typed: state.typed }}
      busy={state.busy}
      checking={state.checking}
      check={state.check}
      error={state.error}
      saved={state.saved}
      confirmingPrivate={state.confirmingPrivate}
      share={share}
      onPick={state.pick}
      onHandleChange={state.changeHandle}
      onSave={state.save}
      onCancelPrivate={state.cancelPrivate}
      onClose={state.close}
    />
  );
}
