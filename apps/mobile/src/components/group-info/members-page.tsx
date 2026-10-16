import { Effect } from 'effect';
import {
  ChevronLeft,
  Crown,
  Link2,
  MoreVertical,
  Shield,
  ShieldCheck,
  ShieldOff,
  UserMinus,
  UserPlus,
} from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { RoleChips } from '@/components/chat/role-chips';
import { NewGroupMembers } from '@/components/group/new-group-members';
import { InfoRow, InfoRowGroup } from '@/components/group-info/info-row';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { SearchField } from '@/components/ui/search-field';
import { Text } from '@/components/ui/text';
import type { GroupMember } from '@/lib/chat-api';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import type { Contact } from '@/lib/contacts-api';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { membersWithChips } from '@/lib/roles';
import type { CustomGroupRole } from '@/lib/roles-api';
import { useChatStore } from '@/store/chat-store-provider';

/** The owner crown from the web `MemberRow` (`#e5b84b`); mobile has no token for it. */
const OWNER_COLOR = '#e5b84b';

type MemberWriteKind = 'add' | 'remove' | 'transfer' | 'role';

const WRITE_ERRORS: Record<MemberWriteKind, string> = {
  add: 'Could not add the members.',
  remove: 'Could not remove the member.',
  transfer: 'Could not hand over the group.',
  role: 'Could not change the member role.',
};

type MemberWrite = {
  kind: MemberWriteKind;
  call: () => Promise<unknown>;
  /** Runs after the write settles successfully, e.g. closing its sheet. */
  after?: () => void;
};

type MembersPageProps = {
  groupId: string;
  members: GroupMember[];
  /** The fresh custom roles, once loaded, so a member's chips stay right. */
  roles: CustomGroupRole[] | undefined;
  me: string | undefined;
  isManager: boolean;
  isOwner: boolean;
  contacts: Contact[];
  /** T-1552: the root's Add key lands here with the picker already open. */
  openPickerOnMount?: boolean;
  onOpenLinks: () => void;
  onOpenRoles: () => void;
  onBack: () => void;
};

/**
 * The Members page (T-1569), after `WebMembers.dc.html`: a search field, the
 * Add members and Invite with a link rows for managers, one rounded list of
 * members (avatar, name and `@handle`, owner/admin as icons, role tags), a ⋮
 * per removable row and a Roles row at the end for managers. Full screen with
 * the root's back key; the write rules are web's, the server is the enforcer.
 */
export function MembersPage({
  groupId,
  members,
  roles,
  me,
  isManager,
  isOwner,
  contacts,
  openPickerOnMount = false,
  onOpenLinks,
  onOpenRoles,
  onBack,
}: MembersPageProps) {
  const addGroupMembers = useChatStore((state) => state.addGroupMembers);
  const removeGroupMember = useChatStore((state) => state.removeGroupMember);
  const transferGroupOwner = useChatStore((state) => state.transferGroupOwner);
  const changeGroupMemberRole = useChatStore((state) => state.changeGroupMemberRole);
  const { height } = useWindowDimensions();
  // `NewGroupMembers` fills a screen with `flex-1`; inside the sheet's scroll
  // view it needs a definite height or it collapses.
  const pickerHeight = Math.round(height * 0.6);

  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(openPickerOnMount);
  const [selected, setSelected] = useState<string[]>([]);
  const [menuFor, setMenuFor] = useState<GroupMember | undefined>(undefined);
  const [pending, setPending] = useState<
    { kind: 'remove' | 'transfer'; member: GroupMember } | undefined
  >(undefined);
  const [removeFor, setRemoveFor] = useState<GroupMember | undefined>(undefined);
  const [transferFor, setTransferFor] = useState<GroupMember | undefined>(undefined);

  const [write, runWrite] = useAction((work: MemberWrite) =>
    Effect.tryPromise({ try: work.call, catch: () => ({ kind: work.kind }) }).pipe(
      Effect.tap(() => Effect.sync(() => work.after?.())),
    ),
  );
  const busy = isWaiting(write);
  const failure = failureOf(write);
  const error = !busy && failure !== undefined ? WRITE_ERRORS[failure.kind] : '';

  const memberIds = new Set(members.map((member) => member.userId));
  const addable = contacts.filter((contact) => !memberIds.has(contact.userId));

  const closePicker = () => {
    setPickerOpen(false);
    setSelected([]);
  };

  const toggleSelected = (userId: string) => {
    setSelected((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  };

  const addSelected = () => {
    if (selected.length > 0) {
      runWrite({ kind: 'add', call: () => addGroupMembers(groupId, selected), after: closePicker });
    }
  };

  const needle = query.trim().toLowerCase();
  const visible =
    needle === ''
      ? members
      : members.filter(
          (member) =>
            member.name.toLowerCase().includes(needle) ||
            (member.handle ?? '').toLowerCase().includes(needle),
        );
  const chipsByUser = new Map(
    membersWithChips(visible, roles).map((row) => [row.userId, row.chips]),
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="h-14 flex-row items-center gap-2 px-3">
        <IconButton label="Back" onPress={onBack}>
          <ChevronLeft size={18} color={ICON} />
        </IconButton>
        <Text className="text-[28px] font-semibold tracking-[-0.02em] text-foreground">
          Members
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="px-4 pb-3">
          <SearchField
            value={query}
            onChangeText={setQuery}
            onClear={() => setQuery('')}
            maxLength={100}
            placeholder="Search"
            accessibilityLabel="Search members"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {isManager ? (
          <View className="px-4 pb-3">
            <InfoRowGroup>
              <InfoRow icon={UserPlus} label="Add members" onPress={() => setPickerOpen(true)} />
              <InfoRow icon={Link2} label="Invite with a link" onPress={onOpenLinks} />
            </InfoRowGroup>
          </View>
        ) : null}

        <View className="px-4">
          <InfoRowGroup>
            {visible.map((member) => {
              const transferable = isOwner && member.userId !== me;
              const removable = isManager && member.role !== 'owner' && member.userId !== me;
              return (
                <View
                  key={member.userId}
                  className="min-h-[48px] flex-row items-center gap-3 px-3 py-2"
                >
                  <EntityAvatar person={member} size={40} />
                  <View className="min-w-0 flex-1">
                    <View className="min-w-0 flex-row items-center gap-1.5">
                      <Text numberOfLines={1} className="shrink text-[15px] text-foreground">
                        {member.name}
                      </Text>
                      {member.handle === undefined ? null : (
                        <Text
                          numberOfLines={1}
                          className="shrink text-[13px] text-muted-foreground"
                        >
                          @{member.handle}
                        </Text>
                      )}
                      {member.role === 'owner' ? (
                        <View accessibilityRole="image" accessibilityLabel="Owner">
                          <Crown size={14} color={OWNER_COLOR} />
                        </View>
                      ) : null}
                      {member.role === 'admin' ? (
                        <View accessibilityRole="image" accessibilityLabel="Admin">
                          <Shield size={14} color={MUTED_FOREGROUND} />
                        </View>
                      ) : null}
                    </View>
                    <RoleChips roles={chipsByUser.get(member.userId) ?? []} />
                  </View>
                  {transferable || removable ? (
                    <IconButton
                      label={`Options for ${member.name}`}
                      className="h-9 w-9"
                      disabled={busy}
                      onPress={() => setMenuFor(member)}
                    >
                      <MoreVertical size={16} color={ICON} />
                    </IconButton>
                  ) : null}
                </View>
              );
            })}
          </InfoRowGroup>
        </View>

        {isManager ? (
          <View className="px-4 pt-3">
            <InfoRowGroup>
              <InfoRow icon={ShieldCheck} label="Roles" onPress={onOpenRoles} />
            </InfoRowGroup>
          </View>
        ) : null}

        {error === '' ? null : (
          <Text accessibilityRole="alert" className="px-4 pt-3 text-center text-[13px] text-danger">
            {error}
          </Text>
        )}
      </ScrollView>

      <ActionSheet
        visible={menuFor !== undefined}
        onClose={() => setMenuFor(undefined)}
        onDismissed={() => {
          if (pending !== undefined) {
            const item = pending;
            setPending(undefined);
            if (item.kind === 'remove') {
              setRemoveFor(item.member);
            } else {
              setTransferFor(item.member);
            }
          }
        }}
        closeLabel="Close member options"
        title={menuFor?.name}
      >
        {isOwner && menuFor !== undefined && menuFor.userId !== me && menuFor.role !== 'owner' ? (
          <ActionSheetItem
            label={menuFor.role === 'admin' ? 'Remove admin' : 'Make admin'}
            icon={menuFor.role === 'admin' ? ShieldOff : ShieldCheck}
            onPress={() => {
              const member = menuFor;
              const role = member.role === 'admin' ? 'member' : 'admin';
              setMenuFor(undefined);
              runWrite({
                kind: 'role',
                call: () => changeGroupMemberRole(groupId, member.userId, role),
              });
            }}
          />
        ) : null}
        {isOwner && menuFor !== undefined && menuFor.userId !== me ? (
          <ActionSheetItem
            label="Make owner"
            icon={Crown}
            onPress={() => {
              setPending({ kind: 'transfer', member: menuFor });
              setMenuFor(undefined);
            }}
          />
        ) : null}
        {menuFor !== undefined && menuFor.role !== 'owner' && menuFor.userId !== me ? (
          <ActionSheetItem
            label="Remove"
            icon={UserMinus}
            destructive
            onPress={() => {
              setPending({ kind: 'remove', member: menuFor });
              setMenuFor(undefined);
            }}
          />
        ) : null}
      </ActionSheet>

      <ConfirmDialog
        visible={transferFor !== undefined}
        title={transferFor === undefined ? '' : `Make ${transferFor.name} the owner?`}
        message="You become an admin."
        confirmLabel="Make owner"
        busyLabel="Making owner…"
        busy={busy}
        error={transferFor !== undefined && failure?.kind === 'transfer' ? error : ''}
        onCancel={() => setTransferFor(undefined)}
        onConfirm={() => {
          if (transferFor !== undefined) {
            const member = transferFor;
            runWrite({
              kind: 'transfer',
              call: () => transferGroupOwner(groupId, member.userId),
              after: () => setTransferFor(undefined),
            });
          }
        }}
      />

      <ConfirmDialog
        visible={removeFor !== undefined}
        title={removeFor === undefined ? '' : `Remove ${removeFor.name}?`}
        message={removeFor === undefined ? '' : `${removeFor.name} will lose access to this group.`}
        confirmLabel="Remove"
        busyLabel="Removing…"
        busy={busy}
        error={removeFor !== undefined && failure?.kind === 'remove' ? error : ''}
        onCancel={() => setRemoveFor(undefined)}
        onConfirm={() => {
          if (removeFor !== undefined) {
            const member = removeFor;
            runWrite({
              kind: 'remove',
              call: () => removeGroupMember(groupId, member.userId),
              after: () => setRemoveFor(undefined),
            });
          }
        }}
      />

      <BottomSheet
        visible={pickerOpen}
        onClose={closePicker}
        closeLabel="Close add members"
        title="Add members"
        footer={
          <View className="gap-3">
            {failure?.kind === 'add' ? (
              <Text accessibilityRole="alert" className="text-center text-[13px] text-danger">
                {error}
              </Text>
            ) : null}
            <Button
              size="lg"
              accessibilityLabel="Add members"
              disabled={selected.length === 0 || busy}
              onPress={addSelected}
            >
              <Text>{busy ? 'Adding…' : 'Add'}</Text>
            </Button>
          </View>
        }
      >
        <View style={{ height: pickerHeight }}>
          <NewGroupMembers contacts={addable} selected={selected} onToggle={toggleSelected} />
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}
