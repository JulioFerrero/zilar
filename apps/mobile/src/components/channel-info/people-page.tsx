import { Crown, MoreVertical, Shield } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { InfoRowGroup } from '@/components/group-info/info-row';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { IconButton } from '@/components/ui/icon-button';
import { SearchField } from '@/components/ui/search-field';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import type { GroupRole } from '@/lib/chat-api';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';

/** The owner crown from the web `MemberRow` (`#e5b84b`); mobile has no token for it. */
const OWNER_COLOR = '#e5b84b';

/** One row of the Subscribers page: the id, the shown name and the role. */
export type ChannelPerson = {
  userId: string;
  name: string;
  handle?: string;
  role: GroupRole;
};

const RANK: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 };

type ChannelPeoplePageProps = {
  /** The audience a manager sees, or the admins slice a subscriber sees. */
  people: ChannelPerson[];
  me: string;
  isOwner: boolean;
  /** The audience is not loaded yet. */
  loading: boolean;
  /** The admins slice load failed (subscribers only). */
  loadFailed: boolean;
  roleBusy: boolean;
  roleError: string;
  onFlipRole: (userId: string, role: 'admin' | 'member') => void;
  onBack: () => void;
};

/**
 * The Subscribers page of channel info (T-1581), after
 * `WebChannelSubscribers.dc.html`: a search field, then the owner and admins
 * first and the subscribers next in one rounded list. Owner and admin show as
 * `Crown` and `Shield` icons. The owner's ⋮ turns a subscriber into an admin
 * and back, replacing the old Promote and Demote word keys; the write rules
 * are web's, the server is the enforcer.
 */
export function ChannelPeoplePage({
  people,
  me,
  isOwner,
  loading,
  loadFailed,
  roleBusy,
  roleError,
  onFlipRole,
  onBack,
}: ChannelPeoplePageProps) {
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState<ChannelPerson | undefined>(undefined);

  const needle = query.trim().toLowerCase();
  const visible = [...people]
    .sort((a, b) => RANK[a.role] - RANK[b.role])
    .filter(
      (person) =>
        needle === '' ||
        person.name.toLowerCase().includes(needle) ||
        (person.handle ?? '').toLowerCase().includes(needle),
    );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScreenHeader variant="sub" title="Subscribers" onBack={onBack} />

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="px-4 pb-3">
          <SearchField
            value={query}
            onChangeText={setQuery}
            onClear={() => setQuery('')}
            maxLength={100}
            placeholder="Search"
            accessibilityLabel="Search subscribers"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {loading ? <Text className="px-4 text-[13px] text-muted-foreground">Loading…</Text> : null}
        {!loading && loadFailed ? (
          <Text accessibilityRole="alert" className="px-4 text-[13px] text-danger">
            Could not load the members. Try again.
          </Text>
        ) : null}

        <View className="px-4">
          <InfoRowGroup>
            {visible.map((person) => {
              const manageable = isOwner && person.role !== 'owner' && person.userId !== me;
              return (
                <View
                  key={person.userId}
                  className="min-h-[48px] flex-row items-center gap-3 px-3 py-2"
                >
                  <EntityAvatar person={person} size={40} />
                  <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
                    <Text numberOfLines={1} className="shrink text-[15px] text-foreground">
                      {person.name}
                    </Text>
                    {person.handle === undefined ? null : (
                      <Text numberOfLines={1} className="shrink text-[13px] text-muted-foreground">
                        @{person.handle}
                      </Text>
                    )}
                    {person.role === 'owner' ? (
                      <View accessibilityRole="image" accessibilityLabel="Owner">
                        <Crown size={14} color={OWNER_COLOR} />
                      </View>
                    ) : null}
                    {person.role === 'admin' ? (
                      <View accessibilityRole="image" accessibilityLabel="Admin">
                        <Shield size={14} color={MUTED_FOREGROUND} />
                      </View>
                    ) : null}
                  </View>
                  {manageable ? (
                    <IconButton
                      label={`Options for ${person.name}`}
                      className="h-9 w-9"
                      disabled={roleBusy}
                      onPress={() => setMenuFor(person)}
                    >
                      <MoreVertical size={16} color={ICON} />
                    </IconButton>
                  ) : null}
                </View>
              );
            })}
          </InfoRowGroup>
        </View>

        {roleError === '' ? null : (
          <Text accessibilityRole="alert" className="px-4 pt-3 text-center text-[13px] text-danger">
            {roleError}
          </Text>
        )}
      </ScrollView>

      <ActionSheet
        visible={menuFor !== undefined}
        onClose={() => setMenuFor(undefined)}
        closeLabel="Close member options"
        title={menuFor?.name}
      >
        {menuFor !== undefined ? (
          <ActionSheetItem
            label={menuFor.role === 'admin' ? 'Remove admin' : 'Make admin'}
            icon={Shield}
            disabled={roleBusy}
            onPress={() => {
              const person = menuFor;
              setMenuFor(undefined);
              onFlipRole(person.userId, person.role === 'admin' ? 'member' : 'admin');
            }}
          />
        ) : null}
      </ActionSheet>
    </SafeAreaView>
  );
}
