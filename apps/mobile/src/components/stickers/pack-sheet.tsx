import { Effect } from 'effect';
import { Image } from 'expo-image';
import {
  ChevronDown,
  ChevronUp,
  CircleMinus,
  Globe,
  Lock,
  Pencil,
  Share2,
  Sticker,
  Trash2,
  X,
} from 'lucide-react-native';
import { Share, View } from 'react-native';

import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { useAction } from '@/lib/effect/use-action';
import {
  isSameOriginStickerUrl,
  stickerImageSource,
  stickerPackUrl,
  type StickerPack,
} from '@/lib/stickers';
import { packCountLabel } from '@/components/stickers/tile-size';

const SHARE_THUMBS = 8;

export function PackSheet({
  pack,
  token,
  meId,
  busy,
  canMoveUp,
  canMoveDown,
  visibilityBusy,
  visibilityError,
  onMove,
  onEdit,
  onMakePrivate,
  onMakeShared,
  onRemove,
  onDelete,
  onClose,
}: {
  pack: StickerPack | null;
  token: string | undefined;
  meId: string | undefined;
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  visibilityBusy: boolean;
  visibilityError: string;
  onMove: (packId: string, direction: -1 | 1) => void;
  onEdit: (packId: string) => void;
  onMakePrivate: (pack: StickerPack) => void;
  onMakeShared: (pack: StickerPack) => void;
  onRemove: (pack: StickerPack) => void;
  onDelete: (pack: StickerPack) => void;
  onClose: () => void;
}) {
  const [, share] = useAction<void, void, never>(() =>
    Effect.tryPromise({
      try: () => Share.share({ message: stickerPackUrl(pack?.id ?? '') }),
      catch: (cause) => cause,
    }).pipe(Effect.ignore),
  );

  const own =
    pack !== null && meId !== undefined && pack.ownerId !== undefined && pack.ownerId === meId;
  const shared = pack?.visibility === 'server';
  const handleEdit = (): void => {
    if (pack !== null) {
      onEdit(pack.id);
    }
  };
  const handleVisibility = (): void => {
    if (pack === null) {
      return;
    }
    if (shared) {
      onMakePrivate(pack);
    } else {
      onMakeShared(pack);
    }
  };
  const handleMove = (direction: -1 | 1): void => {
    if (pack !== null) {
      onMove(pack.id, direction);
    }
  };
  const handleRemove = (): void => {
    if (pack !== null) {
      onRemove(pack);
    }
  };
  const handleDelete = (): void => {
    if (pack !== null) {
      onDelete(pack);
    }
  };

  return (
    <ActionSheet
      visible={pack !== null}
      onClose={onClose}
      closeLabel="Close pack actions"
      error={visibilityError}
      header={
        pack === null ? undefined : (
          <View className="flex-row items-center gap-3 px-4 py-3">
            <View className="min-w-0 flex-1">
              <View className="flex-row items-center gap-1.5">
                <Text numberOfLines={1} className="text-[17px] font-semibold text-foreground">
                  {pack.title}
                </Text>
                {shared ? (
                  <Globe size={14} color={MUTED_FOREGROUND} accessibilityLabel="Shared" />
                ) : null}
              </View>
              <Text className="text-[14px] text-muted-foreground">
                {packCountLabel(pack.stickers.length)}
              </Text>
            </View>
            <IconButton label="Close" onPress={onClose}>
              <X size={16} color={ICON} />
            </IconButton>
          </View>
        )
      }
    >
      {pack === null ? null : (
        <View accessibilityElementsHidden className="flex-row gap-2 px-4 py-3.5">
          {pack.stickers.slice(0, SHARE_THUMBS).map((sticker) => (
            <View
              key={sticker.id}
              className="aspect-square flex-1 items-center justify-center overflow-hidden rounded-xl bg-surface-raised"
            >
              {isSameOriginStickerUrl(sticker.url, API_URL) ? (
                <Image
                  source={stickerImageSource(sticker.url, API_URL, token)}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="contain"
                />
              ) : (
                <Sticker size={18} color={MUTED_FOREGROUND} />
              )}
            </View>
          ))}
        </View>
      )}
      <ActionSheetItem label="Share" icon={Share2} onPress={() => share()} />
      {own ? (
        <>
          <ActionSheetItem label="Edit" icon={Pencil} disabled={busy} onPress={handleEdit} />
          <ActionSheetItem
            label={shared ? 'Make private' : 'Make shared'}
            icon={shared ? Lock : Globe}
            disabled={busy || visibilityBusy}
            onPress={handleVisibility}
          />
        </>
      ) : null}
      {canMoveUp ? (
        <ActionSheetItem
          label="Move up"
          icon={ChevronUp}
          disabled={busy}
          onPress={() => handleMove(-1)}
        />
      ) : null}
      {canMoveDown ? (
        <ActionSheetItem
          label="Move down"
          icon={ChevronDown}
          disabled={busy}
          onPress={() => handleMove(1)}
        />
      ) : null}
      {pack === null ? null : (
        <ActionSheetItem
          label="Remove from panel"
          icon={CircleMinus}
          disabled={busy}
          onPress={handleRemove}
        />
      )}
      {own ? (
        <ActionSheetItem
          label="Delete"
          icon={Trash2}
          disabled={busy}
          destructive
          onPress={handleDelete}
        />
      ) : null}
    </ActionSheet>
  );
}
