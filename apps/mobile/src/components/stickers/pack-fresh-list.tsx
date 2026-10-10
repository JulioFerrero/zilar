import { TriangleAlert, X } from 'lucide-react-native';
import { Image as RNImage, Pressable, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { DANGER, ICON } from '@/lib/colors';
import { well } from '@/lib/depth';
import { formatPreparedSize, type EditorNewItem } from '@/components/stickers/pack-editor';

/**
 * The freshly picked stickers with their per-row status, optional emoji,
 * Retry and Remove. Rendered inside the screen's stickers section, so the
 * section spacing lives in the route.
 */
export function PackFreshList({
  fresh,
  saving,
  onEmojiChange,
  onRetry,
  onRemove,
}: {
  fresh: EditorNewItem[];
  saving: boolean;
  onEmojiChange: (key: string, value: string) => void;
  onRetry: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  if (fresh.length === 0) {
    return null;
  }
  return (
    <View className="gap-2">
      <Text className="text-[14px] font-medium text-foreground">New stickers</Text>
      {fresh.map((item, index) => (
        <View
          key={item.key}
          className="flex-row items-center gap-3 rounded-xl border border-border bg-surface p-2"
        >
          {item.error !== undefined ? (
            <View className="h-14 w-14 items-center justify-center rounded-lg bg-well">
              <TriangleAlert size={22} color={DANGER} />
            </View>
          ) : (
            <RNImage
              source={{ uri: item.uri }}
              style={{ width: 56, height: 56, borderRadius: 8 }}
              resizeMode="contain"
            />
          )}
          <View className="min-w-0 flex-1 gap-1">
            {item.error !== undefined ? (
              <Text accessibilityRole="alert" className="text-[13px] text-danger">
                {item.error}
              </Text>
            ) : (
              <Text className="text-[13px] text-muted-foreground">
                {item.status === 'uploading'
                  ? 'Uploading…'
                  : item.status === 'uploaded'
                    ? 'Uploaded'
                    : 'Ready'}
                {item.bytes > 0
                  ? ` · ${formatPreparedSize(item.width, item.height, item.bytes)}`
                  : ''}
              </Text>
            )}
            {item.error === undefined &&
            item.status !== 'uploading' &&
            item.status !== 'uploaded' ? (
              <View className="flex-row items-center gap-2">
                <View className="h-9 w-14 justify-center rounded-lg px-2" style={well}>
                  <TextInput
                    value={item.emoji}
                    onChangeText={(value) => onEmojiChange(item.key, value)}
                    maxLength={8}
                    accessibilityLabel={`Emoji for sticker ${index + 1}`}
                    editable={!saving}
                    className="text-[16px] text-foreground"
                  />
                </View>
                <Text className="text-[13px] text-muted-foreground">Optional emoji</Text>
              </View>
            ) : null}
          </View>
          <View className="shrink-0 flex-row items-center gap-1">
            {item.status === 'uploadFailed' ? (
              <Button
                variant="outline"
                size="sm"
                accessibilityLabel={`Retry sticker ${index + 1}`}
                disabled={saving}
                onPress={() => onRetry(item.key)}
              >
                <Text>Retry</Text>
              </Button>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove new sticker ${index + 1}`}
              disabled={saving}
              onPress={() => onRemove(item.key)}
              className="h-9 w-9 items-center justify-center rounded-lg active:bg-surface-raised disabled:opacity-60"
            >
              <X size={18} color={ICON} />
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}
