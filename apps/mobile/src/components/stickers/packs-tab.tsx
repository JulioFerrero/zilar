import { CircleMinus, Download, Sticker } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { SectionLabel } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import type { StickerPack } from '@/lib/stickers';
import type { PanelPack } from '@/lib/stickers-api';
import { PackCard } from '@/components/stickers/pack-card';

/**
 * The My packs tab (T-1533): one lean list of your own packs that opens the
 * pack sheet, the Import from Telegram row, and the Added list of other
 * people's packs with a remove key.
 */
export function PacksTab({
  packs,
  token,
  meId,
  busy,
  actionError,
  onRemove,
  onOpenPack,
  onOpenPackLink,
  onImport,
  onOpenDiscover,
}: {
  packs: PanelPack[];
  token: string | undefined;
  meId: string | undefined;
  busy: boolean;
  actionError: string;
  onRemove: (pack: StickerPack) => void;
  /** Opens the pack action sheet. */
  onOpenPack: (packId: string) => void;
  /** Opens the pack link page (`/stickers/<id>`). */
  onOpenPackLink: (packId: string) => void;
  onImport: () => void;
  onOpenDiscover: () => void;
}) {
  // While the viewer id is still unknown, every pack counts as your own so no
  // Added row flashes a remove key on a pack you own.
  const own =
    meId === undefined
      ? packs
      : packs.filter((pack) => pack.ownerId === undefined || pack.ownerId === meId);
  const added = meId === undefined ? [] : packs.filter((pack) => pack.ownerId !== meId);

  return (
    <View className="gap-2">
      {actionError !== '' ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {actionError}
        </Text>
      ) : null}

      {own.length === 0 ? (
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
      ) : null}

      <View className="overflow-hidden rounded-2xl border border-border bg-surface">
        {own.map((pack) => (
          <PackCard
            key={pack.id}
            inList
            pack={pack}
            token={token}
            meId={meId}
            accessibilityLabel={`Open ${pack.title}`}
            onPress={() => onOpenPack(pack.id)}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Import from Telegram"
          disabled={busy}
          onPress={onImport}
          className="flex-row items-center gap-3 px-3 py-3 active:bg-surface-raised disabled:opacity-50"
        >
          <View className="h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-raised">
            <Download size={18} color={MUTED_FOREGROUND} />
          </View>
          <Text className="text-[15px] text-muted-foreground">Import from Telegram</Text>
        </Pressable>
      </View>

      {added.length > 0 ? (
        <View className="mt-4 gap-2">
          <SectionLabel>Added</SectionLabel>
          <View className="overflow-hidden rounded-2xl border border-border bg-surface">
            {added.map((pack, index) => (
              <PackCard
                key={pack.id}
                inList
                divider={index < added.length - 1}
                pack={pack}
                token={token}
                meId={meId}
                accessibilityLabel={`Open ${pack.title}`}
                onPress={() => onOpenPackLink(pack.id)}
                action={
                  <IconButton
                    label={`Remove ${pack.title} from panel`}
                    disabled={busy}
                    onPress={() => onRemove(pack)}
                  >
                    <CircleMinus size={18} color={ICON} />
                  </IconButton>
                }
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
