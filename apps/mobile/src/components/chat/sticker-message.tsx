import type { UiMessage } from '@zilar/chat-core';
import type { Sticker } from '@zilar/protocol';
import { Effect, Fiber } from 'effect';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { metaTimeText } from '@/components/chat/meta-time';
import { Ticks } from '@/components/chat/ticks';
import { Text } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import { MUTED_FOREGROUND, SEEN } from '@/lib/colors';
import { raisedPill } from '@/lib/depth';
import { messageAccessibilityLabel } from '@/lib/message-a11y';
import { getSessionToken } from '@/lib/session-token';
import { isSameOriginStickerUrl, stickerImageSource } from '@/lib/stickers';
import { cn } from '@/lib/utils';

const STICKER_SIZE = 200;

type StickerMessageProps = {
  sticker: Sticker;
  message: UiMessage;
  outgoing: boolean;
  onLongPress: () => void;
};

/**
 * A sticker without a bubble: at most 200 pt on the chat background, with
 * the time and ticks overlaid in a small pill. The image loads from the
 * payload `url` only when it is on the same origin as the Zilar API;
 * anything else shows the emoji or a placeholder so a hostile sender cannot
 * make every viewer's device fetch an arbitrary URL. The bearer token rides
 * along only to the API origin (the file route requires a session).
 */
export function StickerMessage({ sticker, message, outgoing, onLongPress }: StickerMessageProps) {
  const [broken, setBroken] = useState(false);
  const [token, setToken] = useState<string | undefined>(undefined);
  const trusted = isSameOriginStickerUrl(sticker.url, API_URL);
  const alt = sticker.emoji !== undefined && sticker.emoji !== '' ? sticker.emoji : 'Sticker';
  const ratio = sticker.width / sticker.height;

  useEffect(() => {
    if (!trusted) {
      return;
    }
    // The token read is a fiber: cleanup interrupts it, so a late answer for
    // an old URL never sets the token.
    const read = Effect.runFork(
      Effect.promise(() => getSessionToken()).pipe(
        Effect.andThen((value) =>
          Effect.sync(() => {
            setToken(value);
          }),
        ),
      ),
    );
    return () => {
      Effect.runSync(Fiber.interrupt(read));
    };
  }, [trusted]);

  return (
    <Pressable
      onPress={() => router.push(`/stickers/${sticker.pack_id}`)}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="image"
      accessibilityLabel={messageAccessibilityLabel(message, outgoing)}
      accessibilityHint="Opens the sticker pack"
      className={cn('relative', outgoing ? 'items-end' : 'items-start')}
    >
      {trusted && !broken ? (
        <Image
          source={stickerImageSource(sticker.url, API_URL, token)}
          accessibilityLabel={alt}
          onError={() => setBroken(true)}
          style={{ width: STICKER_SIZE, aspectRatio: ratio, maxHeight: STICKER_SIZE }}
          contentFit="contain"
        />
      ) : (
        <View
          accessibilityRole="image"
          accessibilityLabel={alt}
          className="items-center justify-center rounded-[8px] border border-edge bg-surface"
          style={{ width: 120, height: 120 }}
        >
          <Text className="text-[40px] leading-none">{alt === 'Sticker' ? '🙂' : alt}</Text>
        </View>
      )}
      <View
        className="absolute right-1 bottom-1 flex-row items-center gap-1 rounded-full px-2 py-0.5"
        style={raisedPill}
      >
        <Text className="font-mono text-[11px] text-muted-foreground">{metaTimeText(message)}</Text>
        {outgoing ? (
          <Ticks
            status={message.status}
            color={message.status === 'read' ? SEEN : MUTED_FOREGROUND}
            size={13}
          />
        ) : null}
      </View>
    </Pressable>
  );
}
