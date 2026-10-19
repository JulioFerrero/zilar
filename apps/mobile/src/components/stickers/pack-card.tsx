import { Image } from 'expo-image';
import { ChevronRight, Globe, Sticker } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { isSameOriginStickerUrl, stickerImageSource } from '@/lib/stickers';
import { cn } from '@/lib/utils';
import { packCountLabel } from '@/components/stickers/tile-size';
import type { PanelPack } from '@zilar/client-core';

function packMeta(pack: PanelPack, own: boolean): string {
  const count = packCountLabel(pack.stickers.length);
  if (own) {
    return pack.importedFrom === undefined ? count : `${count} · Telegram`;
  }
  return pack.ownerHandle === undefined || pack.ownerHandle === null
    ? count
    : `${count} · @${pack.ownerHandle}`;
}

export function PackCard({
  pack,
  token,
  meId,
  onPress,
  action,
  accessibilityLabel,
  inList = false,
  divider = true,
}: {
  pack: PanelPack;
  token: string | undefined;
  meId?: string | undefined;
  onPress?: (() => void) | undefined;
  action?: React.ReactNode;
  accessibilityLabel?: string;
  inList?: boolean;
  divider?: boolean;
}) {
  const thumbs = pack.stickers.slice(0, 4);
  const own = meId !== undefined && pack.ownerId !== undefined && pack.ownerId === meId;
  const trailing =
    action ?? (onPress === undefined ? null : <ChevronRight size={16} color={MUTED_FOREGROUND} />);
  const body = (
    <View className="flex-row items-center gap-3">
      <View accessibilityElementsHidden className="flex-row gap-1">
        {thumbs.length === 0 ? (
          <View className="h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-raised">
            <Sticker size={18} color={MUTED_FOREGROUND} />
          </View>
        ) : (
          thumbs.map((sticker) => (
            <View
              key={sticker.id}
              className="h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-surface-raised"
            >
              {isSameOriginStickerUrl(sticker.url, API_URL) ? (
                <Image
                  source={stickerImageSource(sticker.url, API_URL, token)}
                  style={{ width: 36, height: 36 }}
                  contentFit="contain"
                />
              ) : null}
            </View>
          ))
        )}
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text numberOfLines={1} className="shrink text-[15px] font-semibold text-foreground">
            {pack.title}
          </Text>
          {pack.visibility === 'server' ? (
            <Globe size={14} color={MUTED_FOREGROUND} accessibilityLabel="Shared" />
          ) : null}
        </View>
        <Text numberOfLines={1} className="text-[14px] text-muted-foreground">
          {packMeta(pack, own)}
        </Text>
      </View>
      {trailing === null ? null : <View className="shrink-0">{trailing}</View>}
    </View>
  );
  const container = cn(
    'px-3 py-2.5',
    inList
      ? divider
        ? 'border-b border-divider'
        : undefined
      : 'rounded-xl border border-border bg-surface',
  );
  return onPress === undefined ? (
    <View className={container}>{body}</View>
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? pack.title}
      onPress={onPress}
      className={cn(container, 'active:bg-surface-raised')}
    >
      {body}
    </Pressable>
  );
}
