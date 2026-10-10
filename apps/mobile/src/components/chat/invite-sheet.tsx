import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Check, Copy, Share2 } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

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
 * The clipboard/share bridge the caller injects: `expo-clipboard` and React
 * Native's `Share` cannot run in Node tests, so this sheet takes callbacks
 * and `new-chat-button.tsx` wires the real modules at the edge (the
 * `group/[id].tsx` pattern).
 */
export function InviteSheet({
  api,
  copyText,
  shareText,
  onClose,
}: {
  api: InvitesApi;
  copyText: (text: string) => Promise<void>;
  shareText: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // A new attempt (Try again) or a new `api` starts a new request; the old
  // one is interrupted, so a result that arrives after close or after a newer
  // request is never rendered.
  const [invite] = useQuery(() => fromApi(() => api.createInvite()), [api, attempt]);
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

  return (
    <InviteSheetBody
      url={url}
      failed={failed}
      copied={copied}
      onCopy={copy}
      onShare={share}
      onRetry={retry}
      onClose={onClose}
    />
  );
}

/**
 * The hook-free invite box body (the `join-link.tsx` `JoinLinkBody` pattern):
 * Node tests call it as a plain function with `react-native` stubbed. The
 * stateful `InviteSheet` above owns the request; this view only renders.
 */
export function InviteSheetBody({
  url,
  failed,
  copied,
  onCopy,
  onShare,
  onRetry,
  onClose,
}: {
  /** The created link; `undefined` while it loads (`Creating link…`). */
  url: string | undefined;
  failed: boolean;
  copied: boolean;
  onCopy: () => void;
  onShare: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <Pressable
      onPress={() => {}}
      className="w-full max-w-xs rounded-2xl border border-border-strong bg-surface p-4"
    >
      <Text className="text-[16px] font-semibold text-foreground">Invite a friend</Text>
      <Text className="mt-1 text-[15px] text-muted-foreground">
        Send them this link. They join Zilar already connected to you.
      </Text>

      {failed ? (
        <>
          <Text accessibilityRole="alert" className="mt-4 text-[14px] text-danger">
            Could not create an invite link. Try again.
          </Text>
          <View className="mt-3 flex-row justify-end gap-2">
            <Button variant="ghost" accessibilityLabel="Close" onPress={onClose}>
              <Text>Close</Text>
            </Button>
            <Button variant="default" accessibilityLabel="Try again" onPress={onRetry}>
              <Text>Try again</Text>
            </Button>
          </View>
        </>
      ) : (
        <>
          <View className="mt-4 rounded-lg border border-divider bg-well px-2 py-2">
            <Text numberOfLines={1} className="text-[13px] text-foreground">
              {url ?? 'Creating link…'}
            </Text>
          </View>
          <View className="mt-2 flex-row gap-2">
            <Button
              variant="default"
              className="flex-1"
              accessibilityLabel="Copy invite link"
              disabled={url === undefined}
              onPress={onCopy}
            >
              {copied ? (
                <Check size={16} color={ACCENT_FOREGROUND} />
              ) : (
                <Copy size={16} color={ACCENT_FOREGROUND} />
              )}
              <Text>{copied ? 'Copied' : 'Copy'}</Text>
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              accessibilityLabel="Share invite link"
              disabled={url === undefined}
              onPress={onShare}
            >
              <Share2 size={16} color="#8a8a8a" />
              <Text>Share</Text>
            </Button>
          </View>
          <View className="mt-4 flex-row justify-end">
            <Button variant="ghost" accessibilityLabel="Close" onPress={onClose}>
              <Text>Close</Text>
            </Button>
          </View>
        </>
      )}
    </Pressable>
  );
}
