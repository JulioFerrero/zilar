import type { Attachment } from '@zilar/protocol';
import { Effect, Fiber } from 'effect';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Video, Play } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { isApiOriginUrl, mediaUrl } from '@/lib/attachment-common';
import { getSessionToken } from '@/lib/session-token';
import { ICON } from '@/lib/colors';

import { isLoadableMediaUrl } from './attachment-message';
import { UploadFailed, UploadOverlay, type MediaUploadProps } from './media-shared';
import { LONG_PRESS_MS } from './message-bubble-decor';
import { useOpenMessageMenu } from './message-menu-context';

const VIDEO_WIDTH = 240;
const VIDEO_HEIGHT = 180;

type AttachmentVideoProps = MediaUploadProps & {
  attachment: Attachment;
  chatId: string;
};

/** An untrusted URL never fetches; GIF-origin videos loop muted, and start
 *  paused under reduce motion. */
export function AttachmentVideo({
  attachment,
  chatId,
  trustedHosts,
  localUri,
  uploading = false,
  progress,
  failed = false,
  onRetry,
}: AttachmentVideoProps) {
  const reduceMotion = useReducedMotion();
  const [view, setView] = useState(false);
  const openMenu = useOpenMessageMenu();
  const longPress =
    openMenu === undefined ? {} : { onLongPress: openMenu, delayLongPress: LONG_PRESS_MS };
  const trusted = isLoadableMediaUrl(attachment.url, trustedHosts);
  // Our own `/upload/` file goes through `GET /api/files` so the request carries
  // the bearer; a local preview or another origin loads directly.
  const uri = localUri ?? (trusted ? mediaUrl(chatId, attachment.url) : undefined);
  // Auth headers go only to the API origin: the upload host serves public URLs,
  // and a header there would leak the session token cross-origin.
  const needsToken = localUri === undefined && uri !== undefined && isApiOriginUrl(uri);
  const [token, setToken] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!needsToken || uri === undefined) {
      return;
    }
    // A cleanup interrupts the read, so a late token never reaches a stale source.
    const fiber = Effect.runFork(
      Effect.tryPromise(() => getSessionToken()).pipe(
        Effect.match({
          onSuccess: (value) => {
            setToken(value);
          },
          onFailure: () => {},
        }),
      ),
    );
    return () => {
      Effect.runSync(Fiber.interrupt(fiber));
    };
  }, [needsToken, uri]);
  const gif = isGifOrigin(attachment);
  const player = useVideoPlayer(
    // The native player is built once per source; an API-origin URL waits for the
    // token so the first request already carries the bearer.
    uri === undefined || (needsToken && token === undefined)
      ? null
      : {
          uri,
          ...(token === undefined || !needsToken
            ? {}
            : { headers: { authorization: `Bearer ${token}` } }),
        },
    (built) => {
      built.loop = gif;
      built.muted = gif;
    },
  );
  const viewRef = useRef<{ enterFullscreen: () => Promise<void> } | null>(null);
  // GIF-origin videos auto-play, except under reduce motion. The state update
  // waits one yield so the effect never cascades a render.
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!gif || reduceMotion || uri === undefined) {
      return;
    }
    const fiber = Effect.runFork(
      Effect.yieldNow.pipe(
        Effect.andThen(
          Effect.sync(() => {
            player.play();
            setPlaying(true);
          }),
        ),
      ),
    );
    return () => {
      Effect.runSync(Fiber.interrupt(fiber));
    };
  }, [gif, reduceMotion, uri, player]);

  if (failed) {
    return <UploadFailed onRetry={onRetry} />;
  }

  if (uri === undefined) {
    return (
      <View className="min-w-[210px] max-w-[320px]">
        <View className="flex-row items-center gap-2.5 rounded-[10px] px-2.5 py-2">
          <View className="h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-surface">
            <Video size={20} color={ICON} />
          </View>
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="text-[13px] font-semibold text-foreground">
              {attachment.name}
            </Text>
            <Text
              numberOfLines={1}
              className="font-mono text-[12px] tabular-nums text-muted-foreground"
            >
              Not loaded: untrusted address
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={gif ? `Play ${attachment.name}` : `Open ${attachment.name} fullscreen`}
        onPress={() => {
          if (gif && !playing) {
            setPlaying(true);
            player.play();
            return;
          }
          setView(true);
        }}
        className="overflow-hidden"
        style={{ width: VIDEO_WIDTH, height: VIDEO_HEIGHT }}
        {...longPress}
      >
        <VideoView
          player={player}
          nativeControls={!gif}
          contentFit="contain"
          style={{ width: VIDEO_WIDTH, height: VIDEO_HEIGHT }}
        />
        {gif && !playing ? (
          <View className="absolute inset-0 items-center justify-center">
            <View className="flex-row items-center gap-1.5 justify-center rounded-full bg-black/60 px-3 py-1.5">
              <Play size={13} color="#ffffff" />
              <Text className="text-[13px] font-semibold text-white">GIF</Text>
            </View>
          </View>
        ) : null}
        {uploading ? <UploadOverlay progress={progress} /> : null}
      </Pressable>
      {uploading ? (
        <Text className="mt-1 px-0.5 text-[12px] text-muted-foreground">Uploading…</Text>
      ) : null}
      {view ? (
        <VideoFullscreen
          player={player}
          name={attachment.name}
          onClose={() => setView(false)}
          viewRef={viewRef}
        />
      ) : null}
    </View>
  );
}

function isGifOrigin(attachment: Attachment): boolean {
  if (attachment.kind !== 'file') {
    return false;
  }
  if (attachment.mime !== 'video/mp4' && attachment.mime !== 'video/webm') {
    return false;
  }
  return attachment.name.startsWith('gif-');
}

function VideoFullscreen({
  player,
  name,
  onClose,
  viewRef,
}: {
  player: ReturnType<typeof useVideoPlayer>;
  name: string;
  onClose: () => void;
  viewRef: { current: { enterFullscreen: () => Promise<void> } | null };
}) {
  useEffect(() => {
    const view = viewRef.current;
    if (view === null) {
      return;
    }
    Effect.runFork(Effect.tryPromise(() => view.enterFullscreen()).pipe(Effect.ignore));
  }, [viewRef]);
  return (
    <View className="absolute inset-0 items-center justify-center bg-black/95">
      <VideoView
        ref={viewRef as never}
        player={player}
        nativeControls
        contentFit="contain"
        style={{ width: '100%', height: '80%' }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Close ${name}`}
        onPress={onClose}
        className="mt-2 rounded-full bg-surface px-4 py-2 active:opacity-80"
      >
        <Text className="text-[15px] font-semibold text-foreground">Close</Text>
      </Pressable>
    </View>
  );
}
