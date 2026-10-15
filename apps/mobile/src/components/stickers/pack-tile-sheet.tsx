import { Image } from 'expo-image';
import { View } from 'react-native';

import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { TextField } from '@/components/ui/text-field';
import type { EditorNewItem } from '@/components/stickers/pack-editor';
import type { PackTileSelection } from '@/components/stickers/pack-grid';
import { API_URL } from '@/lib/auth';
import { isSameOriginStickerUrl, stickerImageSource, type StickerItem } from '@/lib/stickers';

/**
 * The tile the sheet holds, resolved against the live lists at render time so
 * an emoji change or a removal is reflected (and a removed row closes it).
 */
function resolveTile(
  selection: PackTileSelection | null,
  visibleSaved: StickerItem[],
  fresh: EditorNewItem[],
): { saved: StickerItem | undefined; fresh: EditorNewItem | undefined } {
  if (selection === null) {
    return { saved: undefined, fresh: undefined };
  }
  if (selection.kind === 'saved') {
    return {
      saved: visibleSaved.find((sticker) => sticker.id === selection.stickerId),
      fresh: undefined,
    };
  }
  return { saved: undefined, fresh: fresh.find((item) => item.key === selection.key) };
}

/**
 * The sheet one sticker tile opens (T-1548): the sticker at 96 px, then the
 * new-item controls (an Emoji field, Try again after a failed upload, Remove)
 * or the saved sticker's Remove. The tile is dropped on removal, so the sheet
 * closes itself once the row leaves the lists.
 */
export function PackTileSheet({
  selection,
  visibleSaved,
  fresh,
  token,
  saving,
  onClose,
  onChangeEmoji,
  onRetry,
  onRemoveSaved,
  onRemoveFresh,
}: {
  selection: PackTileSelection | null;
  visibleSaved: StickerItem[];
  fresh: EditorNewItem[];
  token: string | undefined;
  saving: boolean;
  onClose: () => void;
  onChangeEmoji: (key: string, value: string) => void;
  onRetry: (key: string) => void;
  onRemoveSaved: (stickerId: string) => void;
  onRemoveFresh: (key: string) => void;
}) {
  const { saved, fresh: freshItem } = resolveTile(selection, visibleSaved, fresh);
  const visible = saved !== undefined || freshItem !== undefined;
  const source =
    freshItem !== undefined
      ? { uri: freshItem.uri }
      : saved !== undefined && isSameOriginStickerUrl(saved.url, API_URL)
        ? stickerImageSource(saved.url, API_URL, token)
        : undefined;
  const changeEmoji =
    freshItem === undefined ? undefined : (value: string) => onChangeEmoji(freshItem.key, value);
  const retry =
    freshItem !== undefined && freshItem.status === 'uploadFailed'
      ? () => onRetry(freshItem.key)
      : undefined;
  const remove =
    saved !== undefined
      ? () => onRemoveSaved(saved.id)
      : freshItem !== undefined
        ? () => onRemoveFresh(freshItem.key)
        : undefined;

  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close sticker actions"
      header={
        <View className="items-center px-4 py-3">
          <View className="h-24 w-24 items-center justify-center overflow-hidden rounded-xl bg-surface-raised">
            {source === undefined ? null : (
              <Image source={source} style={{ width: 96, height: 96 }} contentFit="contain" />
            )}
          </View>
        </View>
      }
    >
      {changeEmoji === undefined ? null : (
        <View className="px-4 py-3">
          <TextField
            label="Emoji"
            value={freshItem?.emoji ?? ''}
            onChangeText={changeEmoji}
            maxLength={8}
            editable={!saving}
            accessibilityLabel="Emoji"
            className="h-11"
          />
        </View>
      )}
      {retry === undefined ? null : (
        <ActionSheetItem label="Try again" disabled={saving} onPress={retry} />
      )}
      {remove === undefined ? null : (
        <ActionSheetItem label="Remove" destructive disabled={saving} onPress={remove} />
      )}
    </ActionSheet>
  );
}
