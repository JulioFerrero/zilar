import { FileText, Image as ImageIcon, X } from 'lucide-react-native';
import { useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import { well } from '@/lib/depth';

/** One staged file as the strip renders it: a thumbnail plus its name and size. */
export type PickedPreview = {
  uri: string;
  name: string;
  size?: number | undefined;
};

const THUMB_SIZE = 64;

function PreviewThumb({ preview, iconColor }: { preview: PickedPreview; iconColor: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View className="h-16 w-16 items-center justify-center rounded-[10px] bg-surface-raised">
        <PreviewFallbackIcon name={preview.name} iconColor={iconColor} />
      </View>
    );
  }
  return (
    <View className="h-16 w-16 items-center justify-center overflow-hidden rounded-[10px] bg-surface-raised">
      <Image
        source={{ uri: preview.uri }}
        accessibilityLabel={preview.name}
        onError={() => setFailed(true)}
        style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
        resizeMode="cover"
      />
    </View>
  );
}

/** The single-file row: the exact look the attach sheet showed before T-1246. */
function PickedPreviewRow({
  preview,
  onRemove,
  iconColor,
}: {
  preview: PickedPreview;
  onRemove: (() => void) | undefined;
  iconColor: string;
}) {
  return (
    <View className="flex-row items-center gap-3 rounded-[10px] px-1 py-2" style={well}>
      <PreviewThumb preview={preview} iconColor={iconColor} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[15px] font-semibold text-foreground">
          {preview.name}
        </Text>
        <Text className="text-[13px] text-muted-foreground">
          {preview.size === undefined
            ? 'Sending with your message'
            : formatPreviewSize(preview.size)}
        </Text>
      </View>
      {onRemove === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove attachment"
          onPress={onRemove}
          className="rounded-[8px] px-3 py-2 active:bg-surface-raised"
        >
          <Text className="text-[14px] font-semibold text-muted-foreground">Remove</Text>
        </Pressable>
      )}
    </View>
  );
}

/** The several-file strip: thumbnails side by side, each with an x to drop it. */
function PickedStripRow({
  previews,
  onRemove,
  iconColor,
}: {
  previews: PickedPreview[];
  onRemove: ((index: number) => void) | undefined;
  iconColor: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 4, paddingVertical: 4 }}
    >
      {previews.map((preview, index) => (
        <View key={`${index}:${preview.uri}`}>
          <PreviewThumb preview={preview} iconColor={iconColor} />
          {onRemove === undefined ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${preview.name}`}
              hitSlop={8}
              onPress={() => onRemove(index)}
              className="absolute -right-1.5 -top-1.5 h-5 w-5 items-center justify-center rounded-full bg-black/70"
            >
              <X size={12} color="#ffffff" />
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

/**
 * The composer's staged attachment strip (T-1246): one file keeps the earlier
 * single-preview row exactly; several show as a horizontal strip of
 * thumbnails, each removable. Pure view: the composer owns the picking.
 */
export function PickedStrip({
  previews,
  onRemove,
}: {
  previews: PickedPreview[];
  onRemove?: ((index: number) => void) | undefined;
}) {
  if (previews.length === 0) {
    return null;
  }
  const iconColor = ICON;
  const first = previews[0];
  if (previews.length === 1 && first !== undefined) {
    return (
      <PickedPreviewRow
        preview={first}
        onRemove={onRemove === undefined ? undefined : () => onRemove(0)}
        iconColor={iconColor}
      />
    );
  }
  return <PickedStripRow previews={previews} onRemove={onRemove} iconColor={iconColor} />;
}

function formatPreviewSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'Sending with your message';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B · sending with your message`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]} · sending with your message`;
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif']);

/** Whether a file name looks like an image, for the preview fallback icon. */
export function isImageName(name: string): boolean {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(extension);
}

/**
 * The icon shown instead of the staged-file thumbnail when it fails to
 * load: `Image` for image names, `FileText` for everything else.
 */
export function PreviewFallbackIcon({ name, iconColor }: { name: string; iconColor: string }) {
  const Icon = isImageName(name) ? ImageIcon : FileText;
  return <Icon size={20} color={iconColor} />;
}
