import { ChevronDown, ChevronUp, Download, Pencil, Plus, Sticker } from 'lucide-react-native';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ACCENT_FOREGROUND, ICON } from '@/lib/colors';
import type { StickerPack } from '@/lib/stickers';
import { PackCard } from '@/components/stickers/pack-card';

/**
 * The My packs tab: the New pack and Import actions and the reorderable pack
 * rows with their Edit and Remove controls.
 */
export function PacksTab({
  packs,
  token,
  meId,
  busy,
  actionError,
  onMove,
  onRemove,
  onEdit,
  onCreate,
  onImport,
  onOpenDiscover,
}: {
  packs: StickerPack[];
  token: string | undefined;
  meId: string | undefined;
  busy: boolean;
  actionError: string;
  onMove: (packId: string, direction: -1 | 1) => void;
  onRemove: (pack: StickerPack) => void;
  onEdit: (packId: string) => void;
  onCreate: () => void;
  onImport: () => void;
  onOpenDiscover: () => void;
}) {
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-[16px] font-semibold text-foreground">My packs</Text>
        <Button
          variant="default"
          size="sm"
          accessibilityLabel="Create a new sticker pack"
          disabled={busy}
          onPress={onCreate}
        >
          <Plus size={16} color={ACCENT_FOREGROUND} />
          <Text>New pack</Text>
        </Button>
      </View>
      <Button
        variant="outline"
        className="h-11 rounded-xl"
        accessibilityLabel="Import from Telegram"
        disabled={busy}
        onPress={onImport}
      >
        <Download size={16} color={ICON} />
        <Text className="text-[15px] text-foreground">Import from Telegram</Text>
      </Button>
      {actionError !== '' ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {actionError}
        </Text>
      ) : null}
      {packs.length === 0 ? (
        <StateMessage
          kind="empty"
          icon={Sticker}
          title="No packs on your panel yet. Look in Discover for shared packs to add."
          action={{
            label: 'Open Discover',
            accessibilityLabel: 'Open Discover',
            onPress: onOpenDiscover,
          }}
        />
      ) : (
        <View className="gap-2">
          {packs.map((pack, index) => (
            <PackCard key={pack.id} pack={pack} token={token} meId={meId}>
              <View className="mt-2 flex-row items-center justify-between border-t border-divider pt-2">
                <View className="flex-row gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-lg"
                    hitSlop={4}
                    accessibilityLabel={`Move ${pack.title} up`}
                    disabled={busy || index === 0}
                    onPress={() => onMove(pack.id, -1)}
                  >
                    <ChevronUp size={20} color={ICON} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-lg"
                    hitSlop={4}
                    accessibilityLabel={`Move ${pack.title} down`}
                    disabled={busy || index === packs.length - 1}
                    onPress={() => onMove(pack.id, 1)}
                  >
                    <ChevronDown size={20} color={ICON} />
                  </Button>
                </View>
                <View className="flex-row items-center gap-2">
                  {meId !== undefined && pack.ownerId !== undefined && pack.ownerId === meId ? (
                    <Button
                      variant="outline"
                      size="sm"
                      accessibilityLabel={`Edit ${pack.title}`}
                      disabled={busy}
                      onPress={() => onEdit(pack.id)}
                    >
                      <Pencil size={14} color={ICON} />
                      <Text>Edit</Text>
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    accessibilityLabel={`Remove ${pack.title}`}
                    disabled={busy}
                    onPress={() => onRemove(pack)}
                  >
                    <Text>Remove</Text>
                  </Button>
                </View>
              </View>
            </PackCard>
          ))}
        </View>
      )}
    </View>
  );
}
