import {
  Archive,
  Brain,
  Globe,
  Lock,
  Plus,
  Wrench,
  Check,
  CheckCircle2,
  RotateCcw,
  Bell,
  LogOut,
} from 'lucide-react-native';
import { Children, type ReactNode, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AiBadge } from '@/components/chat/ai-badge';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { PersonPressable } from '@/components/chat/person-pressable';
import { TopicLinkRow } from '@/components/chat/topic-link-row';
import { memberPerson, type TopicLinePerson } from '@/components/chat/topic-people-line';
import { InfoRow } from '@/components/group-info/info-row';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import type { GroupDetail } from '@/lib/chat-api';
import {
  ACCENT_FOREGROUND,
  MUTED_FOREGROUND,
  FOREGROUND,
  ICON,
  ACCENT,
  DANGER,
} from '@/lib/colors';
import { approverLine, approverOptions, topicAccessRows } from '@/lib/roles';
import type { CustomGroupRole } from '@/lib/roles-api';
import type { ApproverRole, PatchTopicInput, TopicAi, TopicRole } from '@/lib/topics-api';
import type { ChatSummary } from '@/lib/types';
import { cn } from '@/lib/utils';
import { IconTile } from '@/components/ui/icon-tile';
import { ListRow } from '@/components/ui/list-row';
import { isTopicJoined } from '@zilar/chat-core';
import { rawCall } from '@/components/chat/group-action';
import { mutedUntilFor } from '@/lib/chat-prefs';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStore } from '@/store/chat-store-provider';

const MUTE_ERROR = 'Could not change notifications. Try again.';

const TRACK_ON = MUTED_FOREGROUND;
const TRACK_OFF = '#0c0c0c';
const TRACK_BORDER = '#262626';

type TopicMuteLeaveProps = {
  chat: ChatSummary;
  myUserId: string;
  disabled: boolean;
  onAskLeave: () => void;
};

// The bottom group of the In this topic sheet: the Mute row with its 46×28 switch and the red Leave topic row. Only people in a non-General topic see it; the confirm lives in `leave-topic-sheet.tsx`.
function TopicMuteLeave({ chat, myUserId, disabled, onAskLeave }: TopicMuteLeaveProps) {
  const setChatPref = useChatStore((state) => state.setChatPref);
  // A group mute sits on the General row and covers every topic; the switch below writes only this topic's own row.
  const groupMuted = useChatStore((state) =>
    chat.groupId === undefined
      ? false
      : state.chats.some(
          (entry) =>
            entry.groupId === chat.groupId && entry.topic?.isGeneral === true && entry.muted,
        ),
  );
  const [muteState, runMute] = useAction((mutedUntil: string | null) =>
    rawCall(() => setChatPref(chat.id, { mutedUntil })),
  );
  const busy = isWaiting(muteState);
  const error = !busy && failureOf(muteState) !== undefined ? MUTE_ERROR : '';
  const topic = chat.topic;

  if (topic === undefined || topic.isGeneral || !isTopicJoined(topic, myUserId)) {
    return null;
  }

  const muted = chat.muted === true;
  // Clearing this topic's row does not lift an inherited group mute, so the switch must not accept a change it cannot make.
  const inheritedMute = muted && groupMuted;
  const switchDisabled = disabled || busy || inheritedMute;

  return (
    <View className="gap-1">
      <View className="overflow-hidden rounded-[14px] border border-border bg-surface">
        <View className="min-h-[52px] flex-row items-center gap-3 px-3">
          <IconTile>
            <Bell size={16} color={ICON} />
          </IconTile>
          <Text className="min-w-0 flex-1 text-[16px] text-foreground">Mute</Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel={`Mute ${chat.title}`}
            accessibilityHint={inheritedMute ? 'Muted for the whole group' : undefined}
            accessibilityState={{ checked: muted, disabled: switchDisabled }}
            disabled={switchDisabled}
            onPress={() => runMute(muted ? null : mutedUntilFor('forever', new Date()))}
            className="h-[28px] w-[46px] flex-row items-center rounded-full px-[3px]"
            style={{
              backgroundColor: muted ? TRACK_ON : TRACK_OFF,
              borderWidth: 1,
              borderColor: muted ? TRACK_ON : TRACK_BORDER,
              justifyContent: muted ? 'flex-end' : 'flex-start',
            }}
          >
            <View className="h-5 w-5 rounded-full" style={{ backgroundColor: ACCENT }} />
          </Pressable>
        </View>
        {inheritedMute ? (
          <Text className="px-3 pb-2 text-[12px] text-muted-foreground">
            Muted for the whole group.
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Leave ${chat.title}`}
          disabled={disabled}
          onPress={onAskLeave}
          className="min-h-[52px] flex-row items-center gap-3 border-t border-divider px-3 active:bg-surface-raised disabled:opacity-60"
        >
          <View className="w-[34px] items-center justify-center">
            <LogOut size={18} color={DANGER} />
          </View>
          <Text className="text-[16px] text-danger">Leave topic</Text>
        </Pressable>
      </View>
      {error !== '' ? (
        <Text accessibilityRole="alert" className="px-3 text-[13px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

type TopicDoneRowProps = {
  doneAt: string | null;
  patch: (input: PatchTopicInput) => void;
  onError: (message: string) => void;
};

// Mark the topic done or reopen it: any member who can see it may flip it, so the row is not gated. "Mark as done" shows a check, "Reopen" a counter-clockwise arrow.
function TopicDoneRow({ doneAt, patch, onError }: TopicDoneRowProps) {
  const done = doneAt !== null;
  return (
    <ListRow
      icon={
        <IconTile>
          {done ? <RotateCcw size={16} color={ICON} /> : <CheckCircle2 size={16} color={ICON} />}
        </IconTile>
      }
      title={done ? 'Reopen' : 'Mark as done'}
      chevron={false}
      accessibilityLabel={done ? 'Reopen topic' : 'Mark topic as done'}
      onPress={() => {
        onError('');
        patch({ done: !done });
      }}
    />
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <View className="flex-row items-center justify-between px-1">
      <Text className="text-[13px] font-semibold text-muted-foreground">{label}</Text>
      <Text className="font-mono text-[13px] text-muted-foreground">{count}</Text>
    </View>
  );
}

export function InfoGroup({ children }: { children: ReactNode }) {
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

// An error line with a Retry: the topic-roles and group-roles failures share the row, each with its own message and retry.
function RetryRow({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <View className="gap-2 py-1">
      <Text accessibilityRole="alert" className="text-[13px] text-danger">
        {message}
      </Text>
      <Button
        variant="outline"
        accessibilityLabel={retryLabel}
        onPress={onRetry}
        className="self-start"
      >
        <Text>Retry</Text>
      </Button>
    </View>
  );
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [approverOpen, setApproverOpen] = useState(false);
  const topic = chat?.topic;
  // The picker rows and approver options come from the shared helpers, so the block renders what the unit tests pin (attached first, the rest by name).
  const accessRows = topicAccessRows(topic?.visibility ?? 'public', roles, groupRoles);
  const attachedRows = accessRows.filter((row) => row.attached);
  const addableRows = accessRows.filter((row) => !row.attached);
  const approverOpts = approverOptions(roles, approverRole);
  const approverLineText = approverLine(approverRole);
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

          {topic.visibility === 'private' ? (
            <View>
              <Text className="text-[13px] font-semibold text-muted-foreground">Roles</Text>
              {rolesError !== '' ? (
                <RetryRow
                  message={rolesError}
                  retryLabel="Retry loading topic roles"
                  onRetry={onRetryRoles}
                />
              ) : rolesLoading ? (
                <Text className="py-1 text-[14px] text-muted-foreground">Checking your role…</Text>
              ) : (
                <View>
                  {roles.length === 0 ? (
                    <StateMessage
                      kind="empty"
                      size="inline"
                      title="No roles here yet — only the people above can see this topic."
                    />
                  ) : null}
                  {attachedRows.map((row) => (
                    <View key={row.id} className="flex-row items-center gap-2 py-1">
                      <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px]">
                        {row.label}
                      </Text>
                      {canManageRoles ? (
                        <Button
                          variant="outline"
                          size="sm"
                          accessibilityLabel={`Remove ${row.label} from the topic`}
                          onPress={() => onToggleTopicRole(row.id)}
                        >
                          <Text>Remove</Text>
                        </Button>
                      ) : null}
                    </View>
                  ))}
                  {groupRolesError !== '' ? (
                    <RetryRow
                      message={groupRolesError}
                      retryLabel="Retry loading group roles"
                      onRetry={onRetryGroupRoles}
                    />
                  ) : null}
                  {canManageRoles ? (
                    pickerOpen ? (
                      <View className="gap-1 py-1">
                        {addableRows.map((row) => (
                          <Button
                            key={row.id}
                            variant="outline"
                            size="sm"
                            accessibilityLabel={`Add ${row.label} to the topic`}
                            onPress={() => onToggleTopicRole(row.id)}
                          >
                            <Text>{row.label}</Text>
                          </Button>
                        ))}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Done adding roles"
                          onPress={() => setPickerOpen(false)}
                          className="self-start rounded-[10px] px-3 py-1.5 active:bg-surface-raised"
                        >
                          <Text className="text-[14px] text-foreground">Done</Text>
                        </Pressable>
                      </View>
                    ) : addableRows.length > 0 ? (
                      <Button
                        accessibilityLabel="Add roles to the topic"
                        onPress={() => setPickerOpen(true)}
                        className="self-start"
                      >
                        <Text>Add roles</Text>
                      </Button>
                    ) : null
                  ) : null}
                  {canManageRoles ? (
                    approverOpen ? (
                      <View className="gap-1 py-1">
                        {approverOpts.map((option) => (
                          <Pressable
                            key={option.id ?? 'none'}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: option.selected }}
                            accessibilityLabel={`Approvers: ${option.label}`}
                            onPress={() => {
                              setApproverOpen(false);
                              onPickApprover(option.id);
                            }}
                            className="flex-row items-center gap-2 rounded-xl border border-border-strong px-2 py-1.5 active:bg-surface-raised disabled:opacity-50"
                          >
                            <Text numberOfLines={1} className="min-w-0 flex-1 text-[14px]">
                              {option.label}
                            </Text>
                            {option.selected ? <Check size={16} color={FOREGROUND} /> : null}
                          </Pressable>
                        ))}
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Choose approvers"
                        onPress={() => setApproverOpen(true)}
                        className="flex-row items-center gap-2 py-1 active:opacity-80 disabled:opacity-50"
                      >
                        <Text className="text-[13px] font-medium text-muted-foreground">
                          Approvers
                        </Text>
                        <Text className="text-[14px] text-foreground">
                          {approverRole?.name ?? 'Owner and admins only'}
                        </Text>
                      </Pressable>
                    )
                  ) : approverLineText !== undefined ? (
                    <Text className="py-1 text-[13px] text-muted-foreground">
                      {approverLineText}
                    </Text>
                  ) : null}
                </View>
              )}
            </View>
          ) : null}

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
