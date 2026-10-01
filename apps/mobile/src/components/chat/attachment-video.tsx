import type { Attachment } from '@galena/protocol';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { getSessionToken } from '@/lib/session-token';

import { isLoadableMediaUrl } from './attachment-message';

const VIDEO_WIDTH = 240;
const VIDEO_HEIGHT = 180;

type AttachmentVideoProps = {
  attachment: Attachment;
  /** The store's trusted media hosts (service host, domain, upload.domain). */
  trustedHosts: ReadonlySet<string>;
  /** The local preview URI while the bytes are still uploading. */
  localUri?: string | undefined;
  /** True while the bytes are still uploading. */
  uploading?: boolean | undefined;
  /** 0..1 upload progress, when known. */
  progress?: number | undefined;
  /** True when the upload failed; the card shows a Retry instead. */
  failed?: boolean | undefined;
  onRetry?: (() => void) | undefined;
};

/**
 * A video attachment bubble (T-0150): inline `expo-video` with native
 * controls, tap-to-fullscreen. A trusted URL (or the local preview while
 * uploading) auto-loads; an untrusted URL never fetches — the bubble keeps
 * a file row with the "Not loaded" line and the open control stays hidden
 * until fullscreen is requested from a trusted source. GIF-origin videos
 * (`gif-<id>.mp4`) loop muted; regular videos play with sound on tap.
 */
export function AttachmentVideo({
  attachment,
  trustedHosts,
  localUri,
  uploading = false,
  progress,
  failed = false,
  onRetry,
}: AttachmentVideoProps) {
  const [token, setToken] = useState<string | undefined>(undefined);
  const [view, setView] = useState(false);
  const trusted = isLoadableMediaUrl(attachment.url, trustedHosts);
  const uri = localUri ?? (trusted ? attachment.url : undefined);
  const gif = isGifOrigin(attachment);
  // `useVideoPlayer` owns the player: loop/mute are set in the setup
  // callback below, never by mutating the returned player in an effect.
  const player = useVideoPlayer(
    uri === undefined
      ? null
      : {
          uri,
          ...(token === undefined || localUri !== undefined
            ? {}
            : { headers: { authorization: `Bearer ${token}` } }),
        },
    (built) => {
      built.loop = gif;
      built.muted = gif;
    },
  );
  const viewRef = useRef<{ enterFullscreen: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (uri === undefined || localUri !== undefined) {
      return;
    }
    let cancelled = false;
    void getSessionToken().then((value) => {
      if (!cancelled) {
        setToken(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [uri, localUri]);

  if (failed) {
    return (
      <View className="flex-row items-center gap-2 px-0.5">
        <Text className="text-[12px] text-danger">Upload failed</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry upload"
          onPress={onRetry}
          className="rounded px-1 py-0.5 active:bg-surface-raised"
        >
          <Text className="text-[12px] font-semibold text-danger">Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (uri === undefined) {
    return (
      <View className="min-w-[210px] max-w-[320px]">
        <View className="flex-row items-center gap-2.5 rounded-[10px] px-2.5 py-2">
          <View className="h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-surface">
            <Text className="text-[16px] leading-none">📎</Text>
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
        onPress={() => setView(true)}
        className="overflow-hidden rounded-xl border border-edge"
        style={{ width: VIDEO_WIDTH, height: VIDEO_HEIGHT }}
      >
        <VideoView
          player={player}
          nativeControls={!gif}
          contentFit="contain"
          style={{ width: VIDEO_WIDTH, height: VIDEO_HEIGHT }}
        />
        {uploading ? (
          <View className="absolute inset-0 items-center justify-center bg-black/40">
            <ActivityIndicator accessibilityLabel="Uploading" />
            {progress !== undefined ? (
              <Text className="mt-1 font-mono text-[11px] text-foreground">
                {Math.round(progress * 100)}%
              </Text>
            ) : null}
          </View>
        ) : null}
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

/** Whether the attachment came from the GIF path: loops muted inline. */
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
    viewRef.current?.enterFullscreen().catch(() => {});
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
