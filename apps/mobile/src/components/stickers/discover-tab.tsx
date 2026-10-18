import { Check, CircleMinus, Plus } from 'lucide-react-native';
import { ActivityIndicator, View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { SearchField } from '@/components/ui/search-field';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ICON, SEEN } from '@/lib/colors';
import type { PanelPack } from '@/lib/stickers-api';
import { PackCard } from '@/components/stickers/pack-card';
import { DISCOVER_ERROR } from '@/components/stickers/use-stickers-panel';

export function DiscoverTab({
  discover,
  discoverBusy,
  discoverError,
  query,
  actionError,
  busy,
  busyId,
  panelIds,
  token,
  onQueryChange,
  onSearch,
  onAdd,
  onRemove,
  onOpenPackLink,
}: {
  discover: PanelPack[] | undefined;
  discoverBusy: boolean;
  discoverError: string;
  query: string;
  actionError: string;
  busy: boolean;
  busyId: string | null;
  panelIds: Set<string>;
  token: string | undefined;
  onQueryChange: (value: string) => void;
  onSearch: (search: string) => void;
  onAdd: (packId: string) => void;
  onRemove: (pack: PanelPack) => void;
  onOpenPackLink: (packId: string) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="text-[14px] text-muted-foreground">
        Find shared packs from anyone on this server and add them to your panel.
      </Text>
      <SearchField
        value={query}
        onChangeText={onQueryChange}
        onSubmitEditing={() => onSearch(query)}
        maxLength={60}
        returnKeyType="search"
        placeholder="Search shared packs"
        accessibilityLabel="Search sticker packs"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {actionError !== '' ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {actionError}
        </Text>
      ) : null}
      {discoverBusy ? (
        <StateMessage kind="loading" title="Searching…" />
      ) : discover === undefined || discoverError !== '' ? (
        <StateMessage
          kind="error"
          title={discoverError === '' ? DISCOVER_ERROR : discoverError}
          action={{
            label: 'Retry',
            accessibilityLabel: 'Retry loading shared packs',
            onPress: () => onSearch(query),
          }}
        />
      ) : discover.length === 0 ? (
        <View className="items-center px-6 pt-12">
          <Text className="text-center text-[15px] text-muted-foreground">
            No shared packs found. Try another search.
          </Text>
        </View>
      ) : (
        <View className="overflow-hidden rounded-2xl border border-border bg-surface">
          {discover.map((pack, index) => {
            const added = panelIds.has(pack.id);
            return (
              <PackCard
                key={pack.id}
                inList
                divider={index < discover.length - 1}
                pack={pack}
                token={token}
                accessibilityLabel={`Open ${pack.title}`}
                onPress={() => onOpenPackLink(pack.id)}
                action={
                  added ? (
                    <View className="flex-row items-center gap-2">
                      <Check size={18} color={SEEN} aria-hidden />
                      <IconButton
                        label={`Remove ${pack.title} from panel`}
                        disabled={busy}
                        onPress={() => onRemove(pack)}
                      >
                        <CircleMinus size={18} color={ICON} />
                      </IconButton>
                    </View>
                  ) : (
                    <IconButton
                      label={`Add ${pack.title}`}
                      disabled={busy}
                      onPress={() => onAdd(pack.id)}
                    >
                      {busyId === pack.id ? (
                        <ActivityIndicator size="small" color={ICON} />
                      ) : (
                        <Plus size={18} color={ICON} />
                      )}
                    </IconButton>
                  )
                }
              />
            );
          })}
        </View>
      )}
    </View>
  );
}
