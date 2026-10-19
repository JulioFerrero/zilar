// effect-plain: presentational card
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Effect, Fiber } from 'effect';

import { Text } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import { makeChatApi, type ChatApi, type LinkPreview } from '@/lib/chat-api';
import { FOREGROUND, MUTED_FOREGROUND } from '@/lib/colors';
import { well } from '@/lib/depth';
import { safeLinkTarget } from '@/lib/links';
import { getSessionToken } from '@/lib/session-token';
import { useApi } from '@/lib/use-mockable-api';

/**
 * Only the `/api/link-preview/image/<key>` prefix ever loads, so a hostile path cannot reach another origin or receive the session token.
 */

const LINK_PREVIEW_IMAGE_PREFIX = '/api/link-preview/image/';

type LinkPreviewImageSource = { uri: string; headers: Record<string, string> };

function useLinkPreviewImage(path: string | undefined): LinkPreviewImageSource | undefined {
  const allowed = path !== undefined && path.startsWith(LINK_PREVIEW_IMAGE_PREFIX);
  const [headers, setHeaders] = useState<Record<string, string> | undefined>(undefined);
  useEffect(() => {
    if (!allowed) {
      return;
    }
    // A cleanup interrupts the read, so a late token never reaches a stale source.
    const fiber = Effect.runFork(
      Effect.tryPromise(() => getSessionToken()).pipe(
        Effect.match({
          onSuccess: (token) => {
            setHeaders(token === undefined ? undefined : { authorization: `Bearer ${token}` });
          },
          onFailure: () => {},
        }),
      ),
    );
    return () => {
      Effect.runSync(Fiber.interrupt(fiber));
    };
  }, [allowed, path]);
  if (!allowed || headers === undefined) {
    return undefined;
  }
  return { uri: `${API_URL}${path}`, headers };
}

type PreviewState =
  { kind: 'loading' } | { kind: 'none' } | { kind: 'ready'; preview: LinkPreview };

const previewCache = new Map<string, LinkPreview | null>();
const previewInFlight = new Map<string, Promise<LinkPreview | null>>();

function loadPreview(api: ChatApi, url: string): Promise<LinkPreview | null> {
  const cached = previewCache.get(url);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }
  const running = previewInFlight.get(url);
  if (running !== undefined) {
    return running;
  }
  const pending = api.linkPreview === undefined ? undefined : api.linkPreview(url);
  const task = (pending ?? Promise.resolve(null))
    .then((preview) => {
      const value = preview ?? null;
      previewCache.set(url, value);
      return value;
    })
    // A failed call shows no card and is not cached, so a later mount retries.
    .catch(() => null)
    .finally(() => {
      previewInFlight.delete(url);
    });
  previewInFlight.set(url, task);
  return task;
}

export function LinkPreviewCard({ url }: { url: string }) {
  const { api } = useApi(makeChatApi);
  const [state, setState] = useState<PreviewState>({ kind: 'loading' });
  // Called before the early return so the hook order stays stable.
  const imageSource = useLinkPreviewImage(state.kind === 'ready' ? state.preview.image : undefined);
  const [brokenImage, setBrokenImage] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    loadPreview(api, url).then((preview) => {
      if (active) {
        setState(preview === null ? { kind: 'none' } : { kind: 'ready', preview });
      }
    });
    return () => {
      active = false;
    };
  }, [api, url]);

  if (state.kind !== 'ready') {
    return null;
  }

  const { title, description, siteName, image } = state.preview;
  const thumbnail = image !== undefined && image !== brokenImage ? imageSource : undefined;
  const body = (
    <>
      {siteName !== undefined ? (
        <Text
          className="text-[11px] font-medium tracking-wide uppercase"
          color={MUTED_FOREGROUND}
          numberOfLines={1}
        >
          {siteName}
        </Text>
      ) : null}
      {title !== undefined ? (
        <Text
          className="text-[13px] font-semibold leading-snug"
          color={FOREGROUND}
          numberOfLines={1}
        >
          {title}
        </Text>
      ) : null}
      {description !== undefined ? (
        <Text className="text-[12px] leading-snug" color={MUTED_FOREGROUND} numberOfLines={2}>
          {description}
        </Text>
      ) : null}
    </>
  );
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={url}
      onPress={() => {
        const target = safeLinkTarget(url);
        if (target !== undefined) {
          void Linking.openURL(target);
        }
      }}
      className={
        thumbnail !== undefined
          ? 'mt-1.5 flex-row items-start gap-3 rounded-[14px] px-3 py-2 active:opacity-80'
          : 'mt-1.5 gap-0.5 rounded-[14px] px-3 py-2 active:opacity-80'
      }
      style={well}
    >
      {thumbnail !== undefined ? (
        <Image
          recyclingKey={image}
          source={thumbnail}
          onError={() => setBrokenImage(image)}
          className="h-16 w-16 shrink-0 rounded-[14px]"
          contentFit="cover"
        />
      ) : null}
      {thumbnail !== undefined ? <View className="min-w-0 flex-1 gap-0.5">{body}</View> : body}
    </Pressable>
  );
}
