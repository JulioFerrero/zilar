import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Check, Copy, Share2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { ACCENT_FOREGROUND } from '@/lib/colors';
import { fromApi } from '@/lib/effect/api-effect';
import { useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import type { InvitesApi } from '@/lib/invites-api';

/**
 * The invite box (T-0190): creates a personal invite link when it opens (a new
 * link each time, like web's `InviteDialog`), shows it with Copy and the
 * system Share sheet, and reads a fixed failure sentence with Try again.
 *
 * On the kit bottom sheet (T-1451): `title="Invite a friend"`, the header's
 * close key is the way out, and the state's primary (Copy, or Try again after
 * a failure) is the sticky footer. `visible` gates the request, so the link is
 * only created while the sheet is open.
 *
 * The clipboard/share bridge the caller injects: `expo-clipboard` and React
 * Native's `Share` cannot run in Node tests, so this sheet takes callbacks
 * and `new-chat-button.tsx` wires the real modules at the edge (the
 * `group/[id].tsx` pattern).
 */
export function InviteSheet({
  visible,
  api,
  copyText,
  shareText,
  onClose,
}: {
  visible: boolean;
  api: InvitesApi;
  copyText: (text: string) => Promise<void>;
  shareText: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // A new attempt (Try again), a new `api` or a reopen starts a new request;
  // the old one is interrupted, so a result that arrives after close or after
  // a newer request is never rendered. While the sheet is closed nothing is
  // requested (`Effect.never`).
  const [invite] = useQuery(
    () => (visible ? fromApi(() => api.createInvite()) : Effect.never),
    [api, attempt, visible],
  );
  const url = AsyncResult.isSuccess(invite) ? invite.value.url : undefined;
  // A retry shows the loading line at once, so a failure only counts while
  // no request is running.
  const failed = AsyncResult.isFailure(invite) && !AsyncResult.isWaiting(invite);

  const [, copyUrl] = useAction(
    (text: string) =>
      Effect.tryPromise({ try: () => copyText(text), catch: (cause) => cause }).pipe(
        Effect.tap(() => Effect.sync(() => setCopied(true))),
      ),
    { mode: 'replace' },
  );
  const [, shareUrl] = useAction(
    (text: string) =>
      Effect.tryPromise({ try: () => shareText(text), catch: (cause) => cause }).pipe(
        Effect.ignore,
      ),
    { mode: 'replace' },
  );

  const retry = (): void => {
    if (!failed) {
      return;
    }
    setAttempt((count) => count + 1);
  };

  const copy = (): void => {
    if (url === undefined) {
      return;
    }
    copyUrl(url);
  };

  const share = (): void => {
    if (url === undefined) {
      return;
    }
    shareUrl(url);
  };

  // The sheet is now always mounted, so a fresh open must not carry the
  // previous open's Copied state or retry count.
  const close = (): void => {
    setCopied(false);
    setAttempt(0);
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      closeLabel="Close invite"
      title="Invite a friend"
      footer={
        failed ? (
          <Button accessibilityLabel="Try again" onPress={retry}>
            <Text>Try again</Text>
          </Button>
        ) : (
          <Button accessibilityLabel="Copy invite link" disabled={url === undefined} onPress={copy}>
            {copied ? (
              <Check size={16} color={ACCENT_FOREGROUND} />
            ) : (
              <Copy size={16} color={ACCENT_FOREGROUND} />
            )}
            <Text>{copied ? 'Copied' : 'Copy'}</Text>
          </Button>
        )
      }
    >
      <InviteSheetBody url={url} failed={failed} onShare={share} />
    </BottomSheet>
  );
}

/**
 * The hook-free invite box body (the `join-link.tsx` `JoinLinkBody` pattern):
 * Node tests call it as a plain function with `react-native` stubbed. The
 * stateful `InviteSheet` above owns the request and the footer's primary; this
 * view renders the sentence, the link well and the secondary Share key.
 */
export function InviteSheetBody({
  url,
  failed,
  onShare,
}: {
  /** The created link; `undefined` while it loads (`Creating link…`). */
  url: string | undefined;
  failed: boolean;
  onShare: () => void;
}) {
  return (
    <>
      <Text className="mt-1 text-[15px] text-muted-foreground">
        Send them this link. They join Zilar already connected to you.
      </Text>

      {failed ? (
        <Text accessibilityRole="alert" className="mt-4 text-[14px] text-danger">
          Could not create an invite link. Try again.
        </Text>
      ) : (
        <>
          <View className="mt-4 rounded-lg border border-divider bg-well px-2 py-2">
            <Text numberOfLines={1} className="text-[13px] text-foreground">
              {url ?? 'Creating link…'}
            </Text>
          </View>
          <Button
            variant="outline"
            className="mt-2"
            accessibilityLabel="Share invite link"
            disabled={url === undefined}
            onPress={onShare}
          >
            <Share2 size={16} color="#8a8a8a" />
            <Text>Share</Text>
          </Button>
        </>
      )}
    </>
  );
}
