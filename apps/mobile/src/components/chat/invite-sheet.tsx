import { Check, Copy, Share2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { ACCENT_FOREGROUND } from '@/lib/depth';
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
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    api.createInvite().then(
      (invite) => {
        // A result that arrives after close (or after Try again started a
        // newer request) is ignored, never rendered.
        if (active) {
          setUrl(invite.url);
        }
      },
      () => {
        if (active) {
          setFailed(true);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [api, attempt]);

  const retry = (): void => {
    if (!failed) {
      return;
    }
    setFailed(false);
    setAttempt((count) => count + 1);
  };

  const copy = (): void => {
    if (url === undefined) {
      return;
    }
    void copyText(url).then(() => setCopied(true));
  };

  const share = (): void => {
    if (url === undefined) {
      return;
    }
    void shareText(url).catch(() => {});
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              className="rounded-full px-4 py-2 active:bg-surface-raised"
            >
              <Text className="text-[15px] text-muted-foreground">Close</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Try again"
              onPress={onRetry}
              className="rounded-full bg-accent px-4 py-2 active:opacity-90"
            >
              <Text className="text-[15px] font-medium text-accent-foreground">Try again</Text>
            </Pressable>
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy invite link"
              disabled={url === undefined}
              onPress={onCopy}
              className="flex-1 flex-row items-center justify-center gap-1 rounded-full bg-accent px-4 py-2 active:opacity-90 disabled:opacity-60"
            >
              {copied ? (
                <Check size={16} color={ACCENT_FOREGROUND} />
              ) : (
                <Copy size={16} color={ACCENT_FOREGROUND} />
              )}
              <Text className="text-[15px] font-medium text-accent-foreground">
                {copied ? 'Copied' : 'Copy'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share invite link"
              disabled={url === undefined}
              onPress={onShare}
              className="flex-1 flex-row items-center justify-center gap-1 rounded-full border border-border-strong px-4 py-2 active:bg-surface-raised disabled:opacity-60"
            >
              <Share2 size={16} color="#8a8a8a" />
              <Text className="text-[15px] font-medium text-foreground">Share</Text>
            </Pressable>
          </View>
          <View className="mt-4 flex-row justify-end">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              className="rounded-full px-4 py-2 active:bg-surface-raised"
            >
              <Text className="text-[15px] text-muted-foreground">Close</Text>
            </Pressable>
          </View>
        </>
      )}
    </Pressable>
  );
}
