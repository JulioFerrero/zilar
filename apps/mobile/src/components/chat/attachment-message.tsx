import type { Attachment } from '@zilar/protocol';
import { isLoadableMediaUrl } from '@zilar/chat-core';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AttachmentFileRow } from '@/components/chat/file-bubble';
import { UploadFailed, UploadOverlay, type MediaUploadProps } from '@/components/chat/media-shared';
import { LONG_PRESS_MS } from '@/components/chat/message-bubble-decor';
import { useOpenMessageMenu } from '@/components/chat/message-menu-context';
import { Text } from '@/components/ui/text';
import { imageAttachmentRender } from '@/lib/attachments';
import { imageGradient } from '@/lib/image-presets';
import { useMediaSource } from '@/lib/media-source';

const IMAGE_WIDTH = 240;
const MAX_IMAGE_HEIGHT = 320;

type AttachmentImageProps = MediaUploadProps & {
  attachment: Attachment;
  chatId: string;
  outgoing?: boolean | undefined;
  onOpen?: (() => void) | undefined;
};

export function AttachmentImage({
  attachment,
  chatId,
  outgoing = false,
  trustedHosts,
  localUri,
  uploading = false,
  progress,
  failed = false,
  onRetry,
  onOpen,
}: AttachmentImageProps) {
  const [broken, setBroken] = useState(false);
  const openMenu = useOpenMessageMenu();
  const longPress =
    openMenu === undefined ? {} : { onLongPress: openMenu, delayLongPress: LONG_PRESS_MS };
  const trusted = isLoadableMediaUrl(attachment.url, trustedHosts);
  const demoGradient = imageGradient(attachment.url);
  const render = imageAttachmentRender({
    trusted,
    broken,
    hasLocalUri: localUri !== undefined,
  });
  const remote = trusted && !broken;
  // Our own `/upload/` file goes through `GET /api/files` so the request carries
  // the bearer; a local preview or another origin loads directly.
  const loaded = useMediaSource(chatId, attachment.url, remote && localUri === undefined);
  const source = localUri === undefined ? loaded : { uri: localUri };
  const alt = attachment.name;
  const ratio =
    attachment.width !== undefined && attachment.height !== undefined
      ? attachment.width / attachment.height
      : undefined;
  const pressableProps = {
    accessibilityRole: 'image' as const,
    accessibilityLabel: alt,
    onPress: onOpen,
    disabled: onOpen === undefined,
    className: 'overflow-hidden rounded-xl border border-edge',
    ...longPress,
  };

  if (failed) {
    return <UploadFailed onRetry={onRetry} className="flex-row items-center gap-2 px-0.5" />;
  }

  if (demoGradient !== undefined && localUri === undefined) {
    return (
      <View>
        <Pressable {...pressableProps}>
          <LinearGradient
            colors={demoGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={
              ratio === undefined
                ? { width: IMAGE_WIDTH, height: MAX_IMAGE_HEIGHT }
                : { width: IMAGE_WIDTH, aspectRatio: ratio, maxHeight: MAX_IMAGE_HEIGHT }
            }
          />
        </Pressable>
        <Text numberOfLines={1} className="mt-1 px-0.5 text-[13px] font-semibold text-foreground">
          {alt}
        </Text>
        {uploading ? (
          <Text className="mt-1 px-0.5 text-[12px] text-muted-foreground">Uploading…</Text>
        ) : null}
      </View>
    );
  }

  if (render === 'untrusted') {
    return (
      <View>
        <AttachmentFileRow
          attachment={attachment}
          outgoing={outgoing}
          trusted={false}
          onOpen={undefined}
        />
        {uploading ? (
          <Text className="mt-1 px-0.5 text-[12px] text-muted-foreground">Uploading…</Text>
        ) : null}
      </View>
    );
  }

  // A trusted image that failed to fetch is a load problem, not a trust problem.
  if (render === 'load-failed') {
    return (
      <View>
        <AttachmentFileRow
          attachment={attachment}
          outgoing={outgoing}
          loadFailed
          onRetry={() => {
            setBroken(false);
          }}
        />
      </View>
    );
  }

  return (
    <View>
      <Pressable {...pressableProps}>
        <View style={{ width: IMAGE_WIDTH }}>
          <Image
            recyclingKey={localUri ?? attachment.url}
            source={source ?? null}
            accessibilityLabel={alt}
            onError={() => setBroken(true)}
            style={
              ratio === undefined
                ? { width: IMAGE_WIDTH, height: MAX_IMAGE_HEIGHT }
                : { width: IMAGE_WIDTH, aspectRatio: ratio, maxHeight: MAX_IMAGE_HEIGHT }
            }
            contentFit="cover"
          />
          {uploading ? <UploadOverlay progress={progress} /> : null}
        </View>
      </Pressable>
      {uploading ? (
        <Text className="mt-1 px-0.5 text-[12px] text-muted-foreground">Uploading…</Text>
      ) : null}
    </View>
  );
}
