import { photosOf, type UiMessage, type ViewerPhoto } from '@zilar/chat-core';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';

// The props every media attachment shares: the trusted-host gate, the local preview while it uploads, and the upload's own state.
export type MediaUploadProps = {
  trustedHosts: ReadonlySet<string>;
  localUri?: string | undefined;
  uploading?: boolean | undefined;
  progress?: number | undefined;
  failed?: boolean | undefined;
  onRetry?: (() => void) | undefined;
};

// A failed upload keeps the message tappable: the retry runs the caller's send again.
export function UploadFailed({
  onRetry,
  className = 'flex-row items-center gap-2 px-3 py-2',
}: {
  onRetry?: (() => void) | undefined;
  className?: string;
}) {
  return (
    <View className={className}>
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

export function UploadOverlay({ progress }: { progress?: number | undefined }) {
  return (
    <View className="absolute inset-0 items-center justify-center bg-black/40">
      <ActivityIndicator accessibilityLabel="Uploading" />
      {progress !== undefined ? (
        <Text className="mt-1 font-mono text-[11px] text-foreground">
          {Math.round(progress * 100)}%
        </Text>
      ) : null}
    </View>
  );
}

/** The chat's photos in album-first order, and the viewer's target, shared by the two media bodies. */
export function useAttachmentViewer(messages: readonly UiMessage[] | undefined) {
  const [viewer, setViewer] = useState<{ messageId: string; albumIds?: readonly string[] } | null>(
    null,
  );
  const photos = useMemo(() => photosOf(messages ?? []), [messages]);
  const viewerPhotos = useMemo<ViewerPhoto[]>(() => {
    if (viewer === null || viewer.albumIds === undefined) {
      return photos;
    }
    const inScope = new Set(viewer.albumIds);
    const album = viewer.albumIds
      .map((id) => photos.find((photo) => photo.messageId === id))
      .filter((photo): photo is ViewerPhoto => photo !== undefined);
    return [...album, ...photos.filter((photo) => !inScope.has(photo.messageId))];
  }, [photos, viewer]);
  const startIndex =
    viewer === null
      ? 0
      : Math.max(
          0,
          viewerPhotos.findIndex((photo) => photo.messageId === viewer.messageId),
        );
  return { viewer, setViewer, viewerPhotos, startIndex };
}
