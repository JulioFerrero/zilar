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

  // A new request interrupts the old one, so a result arriving after close or
  // after a newer request is never rendered.
  const [invite] = useQuery(
    () => (visible ? fromApi(() => api.createInvite()) : Effect.never),
    [api, attempt, visible],
  );
  const url = AsyncResult.isSuccess(invite) ? invite.value.url : undefined;
  // A retry shows the loading line at once.
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

export function InviteSheetBody({
  url,
  failed,
  onShare,
}: {
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
