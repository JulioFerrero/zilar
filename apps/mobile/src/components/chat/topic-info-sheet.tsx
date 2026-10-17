import { Brain, Globe, Lock, Plus } from 'lucide-react-native';
import { Children, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { AiBadge } from '@/components/chat/ai-badge';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { TopicDoneRow } from '@/components/chat/topic-done-row';
import { TopicInfoRoles } from '@/components/chat/topic-info-roles';
import { TopicLinkRow } from '@/components/chat/topic-link-row';
import { memberPerson, type TopicLinePerson } from '@/components/chat/topic-people-line';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import type { GroupDetail } from '@/lib/chat-api';
import { ACCENT_FOREGROUND, MUTED_FOREGROUND } from '@/lib/colors';
import type { CustomGroupRole } from '@/lib/roles-api';
import type { ApproverRole, PatchTopicInput, TopicRole } from '@/lib/topics-api';
import type { ChatSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The board's `.sec`: a 13 px label on the left, a mono count on the right. */
function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <View className="flex-row items-center justify-between px-1">
      <Text className="text-[13px] font-semibold text-muted-foreground">{label}</Text>
      <Text className="font-mono text-[13px] text-muted-foreground">{count}</Text>
    </View>
  );
}

/**
 * The board's `.group` (`PhonePeople.dc.html`): a `#111` list, one hairline
 * between rows and none after the last.
 */
function InfoGroup({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  return (
    <View className="overflow-hidden rounded-[14px] border border-border bg-surface">
      {items.map((child, index) => (
        <View key={index} className={cn(index > 0 && 'border-t border-divider')}>
          {child}
        </View>
      ))}
    </View>
  );
}

/**
 * The board's AI owner label (T-1785): "yours" when the caller owns the AI,
 * "{first name}'s" for anyone else, and nothing when the group detail does not
 * know the owner (`GroupAi.ownerId` -> `GroupMember.name`). The Add sheet
 * (T-1789) passes `null` as `mineLabel`: the board shows no label on the
 * caller's own AIs there.
 */
export function aiOwnerLabel(
  aiId: string,
  detail: GroupDetail | undefined,
  myUserId: string,
  mineLabel: string | null = 'yours',
): string | undefined {
  const ownerId = detail?.ais.find((entry) => entry.aiId === aiId)?.ownerId;
  if (ownerId === undefined) {
    return undefined;
  }
  if (ownerId === myUserId) {
    return mineLabel ?? undefined;
  }
  const firstName = detail?.members
    .find((member) => member.userId === ownerId)
    ?.name.trim()
    .split(/\s+/)[0];
  return firstName === undefined || firstName === '' ? undefined : `${firstName}'s`;
}

type TopicInfoSheetProps = {
  chat: ChatSummary | null;
  groupTitle: string;
  /** The group detail behind the topic, for people names and AI owners. */
  detail: GroupDetail | undefined;
  /** The signed-in user id, to mark the caller's own row. */
  myUserId: string;
  canArchive: boolean;
  isMember: boolean;
  busy: boolean;
  error: string;
  onLeave: () => void;
  onArchive: () => void;
  onClose: () => void;
  /** The roles attached to this topic (empty until the first load). */
  roles: TopicRole[];
  rolesError: string;
  /** True while the group detail behind the manager bit is still loading:
   *  the sheet says the controls are loading instead of silently hiding
   *  them as a read-only view. */
  rolesLoading: boolean;
  /** A group-roles load failure: the add picker names it with a Retry
   *  instead of silently degrading to attached-only. */
  groupRolesError: string;
  approverRole: ApproverRole | null;
  /** The group's roles, for the manager's add picker. */
  groupRoles: CustomGroupRole[];
  canManageRoles: boolean;
  onToggleTopicRole: (roleId: string) => void;
  onPickApprover: (roleId: string | null) => void;
  onRetryRoles: () => void;
  onRetryGroupRoles: () => void;
  /** The topic patch the link and done rows use (T-1540). */
  patch: (input: PatchTopicInput) => void;
  /** A link or done save failure, shown under the link row. */
  patchError: string;
  /** Sets (or clears) `patchError`, e.g. the link's https check. */
  onPatchError: (message: string) => void;
  /** Opens the "What <AI> remembers" sheet for an AI. When unset the AI
   * rows show no memory button. */
  onOpenAiMemory?: (ai: { id: string; name: string }) => void;
  /** Opens the Add people or AIs sheet (T-1785 part 2). When unset the
   * primary key is not shown. */
  onAdd?: () => void;
};

/**
 * The topic-info sheet opened from the topic header (T-0112), redrawn in
 * T-1785 after `PhonePeople.dc.html`: the topic header, an optional
 * "Add people or AIs" key, the AIs with their owner labels and the topic's
 * people from `memberIds` (the group's members on General). The topic link,
 * the error line, the roles block and Archive / Leave stay below. The screen
 * loads the data; the sheet only renders it.
 */
export function TopicInfoSheet({
  chat,
  groupTitle,
  detail,
  myUserId,
  canArchive,
  isMember,
  busy,
  error,
  onLeave,
  onArchive,
  onClose,
  roles,
  rolesError,
  rolesLoading,
  groupRolesError,
  approverRole,
  groupRoles,
  canManageRoles,
  onToggleTopicRole,
  onPickApprover,
  onRetryRoles,
  onRetryGroupRoles,
  patch,
  patchError,
  onPatchError,
  onOpenAiMemory,
  onAdd,
}: TopicInfoSheetProps) {
  const topic = chat?.topic;
  const ais = topic?.ais ?? [];
  const groupMembers: TopicLinePerson[] = (detail?.members ?? []).map((member) => ({
    id: member.userId,
    name: member.name,
    ...(member.avatarUrl === undefined ? {} : { avatarUrl: member.avatarUrl }),
  }));
  // General lists the whole group; any other topic lists its own people from
  // `memberIds`, skipping ids the group detail has not loaded yet.
  const people: TopicLinePerson[] =
    topic?.isGeneral === true
      ? groupMembers
      : (topic?.memberIds ?? [])
          .map((memberId) => memberPerson(memberId, detail))
          .filter((person): person is TopicLinePerson => person !== undefined);
  return (
    <BottomSheet
      visible={chat !== null}
      onClose={onClose}
      closeLabel="Close topic info"
      maxHeightClassName="max-h-[80%]"
    >
      {chat !== null && topic !== undefined ? (
        <View className="gap-3 py-2">
          <View className="flex-row items-center gap-3">
            <EntityAvatar chat={chat} size={52} />
            <View className="min-w-0 flex-1 gap-0.5">
              <Text numberOfLines={1} className="text-[20px] font-semibold text-foreground">
                {chat.title}
              </Text>
              <View className="flex-row items-center gap-1.5">
                {topic.visibility === 'private' ? (
                  <Lock size={14} color={MUTED_FOREGROUND} accessibilityLabel="Private" />
                ) : (
                  <Globe size={14} color={MUTED_FOREGROUND} accessibilityLabel="Public" />
                )}
                <Text numberOfLines={1} className="shrink text-[14px] text-muted-foreground">
                  {groupTitle}
                </Text>
              </View>
            </View>
          </View>

          {onAdd !== undefined ? (
            <Button
              variant="key"
              accessibilityLabel="Add people or AIs"
              onPress={onAdd}
              className="h-12 gap-2 rounded-[14px]"
            >
              <Plus size={18} color={ACCENT_FOREGROUND} />
              <Text className="text-[16px] font-semibold">Add people or AIs</Text>
            </Button>
          ) : null}

          <View className="gap-2">
            <SectionHeader label="AIs" count={ais.length} />
            {ais.length === 0 ? (
              <StateMessage kind="empty" size="inline" title="No AIs here yet." />
            ) : (
              <InfoGroup>
                {ais.map((ai) => {
                  const owner = aiOwnerLabel(ai.id, detail, myUserId);
                  return (
                    <View key={ai.id} className="min-h-[52px] flex-row items-center gap-3 px-3">
                      <EntityAvatar
                        person={{
                          id: ai.id,
                          name: ai.name,
                          ...(ai.avatarUrl === undefined ? {} : { avatarUrl: ai.avatarUrl }),
                        }}
                        size={34}
                        ai
                      />
                      <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
                        <Text numberOfLines={1} className="shrink text-[16px] text-foreground">
                          {ai.name}
                        </Text>
                        <AiBadge />
                      </View>
                      {owner === undefined ? null : (
                        <Text className="shrink-0 text-[13px] text-muted-foreground">{owner}</Text>
                      )}
                      {onOpenAiMemory !== undefined ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`What ${ai.name} remembers`}
                          onPress={() => onOpenAiMemory(ai)}
                          className="rounded-full p-2 active:bg-surface-raised"
                        >
                          <Brain size={16} color={MUTED_FOREGROUND} />
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </InfoGroup>
            )}
          </View>

          <View className="gap-2">
            <SectionHeader label="People" count={people.length} />
            {people.length === 0 ? (
              <StateMessage kind="empty" size="inline" title="No people here yet." />
            ) : (
              <InfoGroup>
                {people.map((person) => (
                  <View key={person.id} className="min-h-[52px] flex-row items-center gap-3 px-3">
                    <EntityAvatar
                      person={{
                        id: person.id,
                        name: person.name,
                        ...(person.avatarUrl === undefined ? {} : { avatarUrl: person.avatarUrl }),
                      }}
                      size={34}
                    />
                    <Text numberOfLines={1} className="min-w-0 flex-1 text-[16px] text-foreground">
                      {person.name}
                      {person.id === myUserId ? (
                        <Text className="text-[16px] text-muted-foreground"> (you)</Text>
                      ) : null}
                    </Text>
                  </View>
                ))}
              </InfoGroup>
            )}
          </View>

          <View className="gap-1">
            <TopicLinkRow topic={topic} patch={patch} onError={onPatchError} />
            {patchError !== '' ? (
              <Text accessibilityRole="alert" className="px-3 text-[13px] text-danger">
                {patchError}
              </Text>
            ) : null}
          </View>

          {error !== '' ? (
            <Text accessibilityRole="alert" className="text-[13px] text-danger">
              {error}
            </Text>
          ) : null}

          <TopicInfoRoles
            visibility={topic.visibility}
            roles={roles}
            rolesError={rolesError}
            rolesLoading={rolesLoading}
            groupRolesError={groupRolesError}
            approverRole={approverRole}
            groupRoles={groupRoles}
            canManageRoles={canManageRoles}
            onToggleTopicRole={onToggleTopicRole}
            onPickApprover={onPickApprover}
            onRetryRoles={onRetryRoles}
            onRetryGroupRoles={onRetryGroupRoles}
          />

          <TopicDoneRow doneAt={topic.doneAt} patch={patch} onError={onPatchError} />

          <View className="flex-row justify-end gap-2">
            {topic.visibility === 'private' && isMember && !topic.isGeneral ? (
              <Button
                variant="ghost"
                accessibilityLabel="Leave topic"
                disabled={busy}
                onPress={onLeave}
              >
                <Text>Leave</Text>
              </Button>
            ) : null}
            {canArchive ? (
              <Button
                variant="destructive"
                accessibilityLabel="Archive topic"
                disabled={busy}
                onPress={onArchive}
              >
                <Text>{busy ? 'Working…' : 'Archive'}</Text>
              </Button>
            ) : null}
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}
