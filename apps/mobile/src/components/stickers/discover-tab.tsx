import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { SearchField } from '@/components/ui/search-field';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import type { StickerPack } from '@/lib/stickers';
import { PackCard } from '@/components/stickers/pack-card';
import { DISCOVER_ERROR } from '@/components/stickers/use-stickers-panel';

/**
 * The Discover tab: the shared-pack search and the pack rows with their
 * Add or Remove action.
 */
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
}: {
  discover: StickerPack[] | undefined;
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
  onRemove: (pack: StickerPack) => void;
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
        <View className="gap-2">
          {discover.map((pack) => {
            const added = panelIds.has(pack.id);
            return (
              <PackCard
                key={pack.id}
                pack={pack}
                token={token}
                action={
                  added ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      accessibilityLabel={`Remove ${pack.title}`}
                      disabled={busy}
                      onPress={() => onRemove(pack)}
                    >
                      <Text>Remove</Text>
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      className="shrink-0"
                      accessibilityLabel={`Add ${pack.title}`}
                      disabled={busy}
                      onPress={() => onAdd(pack.id)}
                    >
                      <Text>{busyId === pack.id ? 'Adding…' : 'Add'}</Text>
                    </Button>
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
