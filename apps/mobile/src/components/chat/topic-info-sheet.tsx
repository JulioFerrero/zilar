import { Archive, Brain, Globe, Lock, Plus, Wrench } from 'lucide-react-native';
import { Children, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { AiBadge } from '@/components/chat/ai-badge';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { PersonPressable } from '@/components/chat/person-pressable';
import { TopicDoneRow } from '@/components/chat/topic-done-row';
import { TopicInfoRoles } from '@/components/chat/topic-info-roles';
import { TopicLinkRow } from '@/components/chat/topic-link-row';
import { TopicMuteLeave } from '@/components/chat/topic-mute-leave';
import { memberPerson, type TopicLinePerson } from '@/components/chat/topic-people-line';
import { InfoRow } from '@/components/group-info/info-row';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import type { GroupDetail } from '@/lib/chat-api';
import { ACCENT_FOREGROUND, MUTED_FOREGROUND } from '@/lib/colors';
import type { CustomGroupRole } from '@/lib/roles-api';
import type { ApproverRole, PatchTopicInput, TopicAi, TopicRole } from '@/lib/topics-api';
import type { ChatSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <View className="flex-row items-center justify-between px-1">
      <Text className="text-[13px] font-semibold text-muted-foreground">{label}</Text>
      <Text className="font-mono text-[13px] text-muted-foreground">{count}</Text>
    </View>
  );
}

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

// "yours" when the caller owns the AI, "{first name}'s" otherwise, nothing when the owner is unknown; the Add sheet passes `null` as `mineLabel`.
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
  detail: GroupDetail | undefined;
  myUserId: string;
  canArchive: boolean;
  busy: boolean;
  error: string;
  onAskLeave: () => void;
  onArchive: () => void;
  onClose: () => void;
  roles: TopicRole[];
  rolesError: string;
  // While the group detail loads, say so instead of hiding the controls as a read-only view.
  rolesLoading: boolean;
  // A group-roles load failure: the add picker names it with a Retry instead of degrading to attached-only.
  groupRolesError: string;
  approverRole: ApproverRole | null;
  groupRoles: CustomGroupRole[];
  canManageRoles: boolean;
  onToggleTopicRole: (roleId: string) => void;
  onPickApprover: (roleId: string | null) => void;
  onRetryRoles: () => void;
  onRetryGroupRoles: () => void;
  patch: (input: PatchTopicInput) => void;
  patchError: string;
  onPatchError: (message: string) => void;
  onOpenAiMemory?: (ai: { id: string; name: string }) => void;
  onAdd?: () => void;
  onOpenTools?: () => void;
};

// The topic-info sheet from the topic header: header, add-people key, AIs with owner labels, people from `memberIds` (the group's on General), link, error, roles, tools, Mute/Leave and Archive. The screen loads; the sheet renders.
export function TopicInfoSheet({
  chat,
  groupTitle,
  detail,
  myUserId,
  canArchive,
  busy,
  error,
  onAskLeave,
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
  onOpenTools,
}: TopicInfoSheetProps) {
  const topic = chat?.topic;
  // General is the whole group, so its AIs are `group_ais`; a General topic has no `topic_ais` rows. The rows carry the AI's JID so each opens the AI.
  const ais: TopicAi[] =
    topic?.isGeneral === true
      ? (detail?.ais ?? []).map((ai) => ({
          id: ai.aiId,
          name: ai.name,
          jid: ai.jid,
          ...(ai.avatarUrl === undefined ? {} : { avatarUrl: ai.avatarUrl }),
        }))
      : (topic?.ais ?? []);
  const groupMembers: TopicLinePerson[] = (detail?.members ?? []).map((member) => ({
    id: member.userId,
    name: member.name,
    ...(member.avatarUrl === undefined ? {} : { avatarUrl: member.avatarUrl }),
  }));
  const handles = new Map((detail?.members ?? []).map((m) => [m.userId, m.handle] as const));
  // General lists the whole group; any other topic lists its own `memberIds`, skipping ids the detail has not loaded.
  const people: TopicLinePerson[] =
    topic?.isGeneral === true
      ? groupMembers
      : (topic?.memberIds ?? [])
          .map((memberId) => memberPerson(memberId, detail))
          .filter((person): person is TopicLinePerson => person !== undefined);
  const rows = people.map((person) => ({ ...person, handle: handles.get(person.id) }));
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
                  // The avatar and name open the AI; the owner label and memory key stay outside the tap.
                  const person = (
                    <>
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
                    </>
                  );
                  return (
                    <View key={ai.id} className="min-h-[52px] flex-row items-center gap-3 px-3">
                      {ai.jid === undefined ? (
                        person
                      ) : (
                        <PersonPressable
                          target={{ jid: ai.jid }}
                          name={ai.name}
                          className="min-w-0 flex-1 flex-row items-center gap-3"
                        >
                          {person}
                        </PersonPressable>
                      )}
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
                {rows.map(({ id, name, avatarUrl, handle }) => (
                  <PersonPressable key={id} target={{ userId: id, handle }} name={name}>
                    <View className="min-h-[52px] flex-row items-center gap-3 px-3">
                      <EntityAvatar
                        person={{ id, name, ...(avatarUrl === undefined ? {} : { avatarUrl }) }}
                        size={34}
                      />
                      <Text
                        numberOfLines={1}
                        className="min-w-0 flex-1 text-[16px] text-foreground"
                      >
                        {name}
                        {id === myUserId ? (
                          <Text className="text-[16px] text-muted-foreground"> (you)</Text>
                        ) : null}
                      </Text>
                    </View>
                  </PersonPressable>
                ))}
              </InfoGroup>
            )}
          </View>

          {onOpenTools !== undefined ? (
            <InfoGroup>
              <InfoRow icon={Wrench} label="Tools and routines" onPress={onOpenTools} />
            </InfoGroup>
          ) : null}

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

          {topic.isGeneral !== true ? (
            <TopicDoneRow doneAt={topic.doneAt} patch={patch} onError={onPatchError} />
          ) : null}

          <TopicMuteLeave chat={chat} myUserId={myUserId} disabled={busy} onAskLeave={onAskLeave} />

          {canArchive ? (
            <InfoGroup>
              <InfoRow
                icon={Archive}
                label="Archive topic"
                danger
                onPress={() => {
                  if (!busy) {
                    onArchive();
                  }
                }}
              />
            </InfoGroup>
          ) : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}
