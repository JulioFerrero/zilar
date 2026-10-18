import { fileExtension } from '@zilar/chat-core';
import { FileText, Image as ImageIcon, X } from 'lucide-react-native';
import { useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { classifyMobileFile, formatFileSize } from '@/lib/attachments';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { well } from '@/lib/depth';

export type PickedPreview = {
  uri: string;
  name: string;
  size?: number | undefined;
  mimeType?: string | undefined;
};

const THUMB_SIZE = 64;
const TILE_SIZE = 72;

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

function PhotoTile({ preview }: { preview: PickedPreview }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View className="h-[72px] w-[72px] items-center justify-center rounded-[10px] border border-edge bg-surface">
        <ImageIcon size={18} color={MUTED_FOREGROUND} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: preview.uri }}
      accessibilityLabel={preview.name}
      onError={() => setFailed(true)}
      className="h-[72px] w-[72px] rounded-[10px] border border-edge"
      style={{ width: TILE_SIZE, height: TILE_SIZE }}
      resizeMode="cover"
    />
  );
}

function FileTile({ preview }: { preview: PickedPreview }) {
  const extension = fileExtension(preview.name);
  const size = preview.size === undefined ? '' : formatFileSize(preview.size);
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={size === '' ? preview.name : `${preview.name}, ${size}`}
      className="h-[72px] w-[72px] items-center justify-center gap-[3px] rounded-[10px] border border-edge bg-surface"
    >
      <FileText size={18} color={MUTED_FOREGROUND} />
      {extension === '' ? null : (
        <Text className="font-mono-medium text-[10px] text-[#d4d4d4]">{extension}</Text>
      )}
      {size === '' ? null : (
        <Text className="font-mono text-[10px] text-subtle-foreground">{size}</Text>
      )}
    </View>
  );
}

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

function PickedStripRow({
  previews,
  onRemove,
}: {
  previews: PickedPreview[];
  onRemove: ((index: number) => void) | undefined;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 10, paddingHorizontal: 4, paddingVertical: 4 }}
    >
      {previews.map((preview, index) => (
        <View key={`${index}:${preview.uri}`}>
          {classifyMobileFile(preview) === 'image' ? (
            <PhotoTile preview={preview} />
          ) : (
            <FileTile preview={preview} />
          )}
          {onRemove === undefined ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${preview.name}`}
              hitSlop={8}
              onPress={() => onRemove(index)}
              className="absolute -right-1.5 -top-1.5 h-5 w-5 items-center justify-center rounded-full bg-black/80"
            >
              <X size={11} color="#ffffff" />
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

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
  const first = previews[0];
  if (previews.length === 1 && first !== undefined) {
    return (
      <PickedPreviewRow
        preview={first}
        onRemove={onRemove === undefined ? undefined : () => onRemove(0)}
        iconColor={ICON}
      />
    );
  }
  return <PickedStripRow previews={previews} onRemove={onRemove} />;
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

export function isImageName(name: string): boolean {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(extension);
}

export function PreviewFallbackIcon({ name, iconColor }: { name: string; iconColor: string }) {
  const Icon = isImageName(name) ? ImageIcon : FileText;
  return <Icon size={20} color={iconColor} />;
}
