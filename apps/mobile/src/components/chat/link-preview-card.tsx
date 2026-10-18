// effect-plain: presentational card
import { Image } from 'expo-image';
import { useGlobalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import { createChatApi, type ChatApi, type LinkPreview } from '@/lib/chat-api';
import { FOREGROUND, MUTED_FOREGROUND } from '@/lib/colors';
import { well } from '@/lib/depth';
import { useLinkPreviewImage } from '@/lib/link-preview-image';
import { safeLinkTarget } from '@/lib/links';
import { getSessionToken } from '@/lib/session-token';
import { ENV_MOCK, apiMockActive, mockParamAllowed, mockToken } from '@/mock/gate';

/** Builds the mock `ChatApi` behind a literal build-time condition: Metro folds
 *  it to `false`, so the mock stays out of a release bundle. */
function createMockChatApi(): ChatApi {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mockFetch } = require('@/mock/backend') as typeof import('@/mock/backend');
    return createChatApi(mockToken, mockFetch, API_URL);
  }
  throw new Error('The mock API is not part of this build');
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
  const params = useGlobalSearchParams();
  const mock = apiMockActive(
    ENV_MOCK,
    params,
    mockParamAllowed({ dev: __DEV__, envMock: ENV_MOCK }),
  );
  const api = useMemo(() => (mock ? createMockChatApi() : createChatApi(getSessionToken)), [mock]);
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
