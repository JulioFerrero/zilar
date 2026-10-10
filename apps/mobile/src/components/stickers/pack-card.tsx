import { Sticker } from 'lucide-react-native';
import { Image, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { isSameOriginStickerUrl, stickerImageSource, type StickerPack } from '@/lib/stickers';
import { cn } from '@/lib/utils';
import { packCountLabel } from '@/components/stickers/tile-size';

/** One pack row: the thumbnail strip, the title and count, and the action. */
export function PackCard({
  pack,
  token,
  action,
  children,
  meId,
}: {
  pack: StickerPack;
  token: string | undefined;
  /** Discover rows pass Add/Remove here; My packs rows render none (brief §3). */
  action?: React.ReactNode;
  children?: React.ReactNode;
  /** The signed-in user id: own packs get the subtitle and the Edit pill. */
  meId?: string | undefined;
}) {
  const thumbs = pack.stickers.slice(0, 3);
  const own = meId !== undefined && pack.ownerId !== undefined && pack.ownerId === meId;
  const subtitle =
    own && pack.importedFrom !== undefined
      ? `${packCountLabel(pack.stickers.length)} · Imported`
      : own && pack.visibility === 'server'
        ? `${packCountLabel(pack.stickers.length)} · Shared`
        : own
          ? `${packCountLabel(pack.stickers.length)} · Private`
          : packCountLabel(pack.stickers.length);
  return (
    <View className="gap-1 rounded-xl border border-border bg-surface px-3 py-2.5">
      <View className="flex-row items-center gap-3">
        <View accessibilityElementsHidden className="flex-row">
          {thumbs.length === 0 ? (
            <View className="h-9 w-9 items-center justify-center rounded-[10px] border border-border bg-surface-raised">
              <Sticker size={18} color={MUTED_FOREGROUND} />
            </View>
          ) : (
            thumbs.map((sticker, index) => (
              <View
                key={sticker.id}
                className={cn(
                  'h-9 w-9 items-center justify-center rounded-[10px] border border-border bg-surface-raised',
                  index === 0 ? '' : '-ml-2',
                )}
              >
                {isSameOriginStickerUrl(sticker.url, API_URL) ? (
                  <Image
                    source={stickerImageSource(sticker.url, API_URL, token)}
                    style={{ width: 28, height: 28 }}
                    resizeMode="contain"
                  />
                ) : null}
              </View>
            ))
          )}
        </View>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
            {pack.title}
          </Text>
          <Text className="text-[13px] text-muted-foreground">{subtitle}</Text>
        </View>
        {action === undefined ? null : <View className="shrink-0">{action}</View>}
      </View>
      {children}
    </View>
  );
}
