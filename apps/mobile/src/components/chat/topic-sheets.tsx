import { Lock } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/chat/avatar';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { approverLine, topicRoleLabel } from '@/lib/roles';
import type { CustomGroupRole } from '@/lib/roles-api';
import type { ApproverRole, TopicMember, TopicRole } from '@/lib/topics-api';
import type { ChatSummary } from '@/lib/types';
import { useColorScheme } from 'nativewind';

export type TopicSheetAction = 'mute' | 'archive';

/**
 * The long-press sheet on a topic row (T-0112): Mute always, Archive for
 * managers (never General — the caller hides it). Thin view; the screen
 * performs the actions.
 */
export function TopicActionsSheet({
  chat,
  canArchive,
  onAction,
  onClose,
}: {
  chat: ChatSummary | null;
  canArchive: boolean;
  onAction: (action: TopicSheetAction) => void;
  onClose: () => void;
}) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={chat !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close topic actions"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40 px-2"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <Pressable onPress={() => {}} className="overflow-hidden rounded-2xl bg-background">
          {chat !== null ? (
            <View className="flex-row items-center gap-3 border-b border-divider px-4 py-3">
              <View className="h-9 w-9 items-center justify-center rounded-[10px] border border-edge bg-surface-raised">
                <Text className="text-[16px] font-semibold text-foreground">
                  {chat.topic?.glyph ?? 'G'}
                </Text>
              </View>
              <Text numberOfLines={1} className="min-w-0 flex-1 text-[16px] font-semibold">
                {chat.title}
              </Text>
              {chat.topic?.visibility === 'private' ? (
                <Lock size={16} color={MUTED_FOREGROUND[scheme]} />
              ) : null}
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mute topic"
            onPress={() => onAction('mute')}
            className="border-b border-divider px-4 py-3.5 active:bg-surface-raised"
          >
            <Text className="text-[16px] text-foreground">Mute</Text>
          </Pressable>
          {canArchive ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Archive topic"
              onPress={() => onAction('archive')}
              className="px-4 py-3.5 active:bg-surface-raised"
            >
              <Text className="text-[16px] text-danger">Archive</Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * The topic-info sheet opened from the topic header (T-0112): visibility,
 * members (private list with Leave for a member), AIs in the topic, and
 * Archive / Leave actions for managers and members. The screen loads the
 * data; the sheet only renders it.
 */
export function TopicInfoSheet({
  chat,
  groupTitle,
  members,
  ais,
  aiCount,
  canArchive,
  isMember,
  busy,
  error,
  onLeave,
  onArchive,
  onClose,
  roles,
  rolesError,
  approverRole,
  groupRoles,
  canManageRoles,
  onToggleTopicRole,
  onPickApprover,
  onRetryRoles,
}: {
  chat: ChatSummary | null;
  groupTitle: string;
  members: TopicMember[];
  ais: { id: string; name: string }[];
  aiCount: number;
  canArchive: boolean;
  isMember: boolean;
  busy: boolean;
  error: string;
  onLeave: () => void;
  onArchive: () => void;
  onClose: () => void;
  /** The roles attached to this topic (`undefined` while loading). */
  roles: TopicRole[];
  rolesError: string;
  approverRole: ApproverRole | null;
  /** The group's roles, for the manager's add picker. */
  groupRoles: CustomGroupRole[];
  canManageRoles: boolean;
  onToggleTopicRole: (roleId: string) => void;
  onPickApprover: (roleId: string | null) => void;
  onRetryRoles: () => void;
}) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const insets = useSafeAreaInsets();
  const topic = chat?.topic;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [approverOpen, setApproverOpen] = useState(false);
  const isPrivate = topic?.visibility === 'private';
  const attachedIds = new Set(roles.map((role) => role.id));
  const addable = groupRoles.filter((role) => !attachedIds.has(role.id));
  const line = approverLine(approverRole);
  return (
    <Modal visible={chat !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close topic info"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40"
      >
        <Pressable
          onPress={() => {}}
          className="max-h-[80%] rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <View className="mb-1 h-1 w-10 self-center rounded-full bg-surface-raised" />
          {chat !== null && topic !== undefined ? (
            <View className="gap-3 py-2">
              <View className="flex-row items-center gap-3">
                <Avatar id={chat.id} name={chat.title} size={44} />
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-[17px] font-semibold text-foreground">
                    {chat.title}
                  </Text>
                  <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
                    {groupTitle} · {topic.visibility === 'private' ? 'Private' : 'Public'}
                  </Text>
                </View>
                {topic.visibility === 'private' ? (
                  <Lock size={16} color={MUTED_FOREGROUND[scheme]} />
                ) : null}
              </View>

              <View>
                <Text className="text-[13px] font-semibold text-muted-foreground">
                  {topic.visibility === 'private'
                    ? `Members (${members.length})`
                    : `All ${chat.memberCount ?? members.length} members of the group`}
                </Text>
                {topic.visibility === 'private'
                  ? members.map((member) => (
                      <View key={member.userId} className="flex-row items-center gap-2 py-1.5">
                        <Avatar id={member.userId} name={member.name} size={28} />
                        <Text numberOfLines={1} className="flex-1 text-[15px] text-foreground">
                          {member.name}
                        </Text>
                      </View>
                    ))
                  : null}
              </View>

              <View>
                <Text className="text-[13px] font-semibold text-muted-foreground">
                  AIs in this topic ({aiCount})
                </Text>
                {ais.map((ai) => (
                  <View key={ai.id} className="flex-row items-center gap-2 py-1.5">
                    <Avatar id={ai.id} name={ai.name} size={28} ai />
                    <Text numberOfLines={1} className="flex-1 text-[15px] text-foreground">
                      {ai.name}
                    </Text>
                  </View>
                ))}
                {ais.length === 0 ? (
                  <Text className="py-1 text-[14px] text-muted-foreground">No AIs here yet.</Text>
                ) : null}
              </View>

              {error !== '' ? (
                <Text accessibilityRole="alert" className="text-[13px] text-danger">
                  {error}
                </Text>
              ) : null}

              {isPrivate ? (
                <View>
                  <Text className="text-[13px] font-semibold text-muted-foreground">Roles</Text>
                  {rolesError !== '' ? (
                    <View className="gap-2 py-1">
                      <Text accessibilityRole="alert" className="text-[13px] text-danger">
                        {rolesError}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Retry loading topic roles"
                        onPress={onRetryRoles}
                        className="self-start rounded-[10px] border border-border-strong px-4 py-2 active:bg-surface-raised disabled:opacity-50"
                      >
                        <Text className="text-[14px] text-foreground">Retry</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View>
                      {roles.length === 0 ? (
                        <Text className="py-1 text-[14px] text-muted-foreground">
                          No roles here yet — only the people above can see this topic.
                        </Text>
                      ) : null}
                      {roles.map((role) => (
                        <View key={role.id} className="flex-row items-center gap-2 py-1">
                          <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px]">
                            {topicRoleLabel(role)}
                          </Text>
                          {canManageRoles ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Remove ${role.name} from the topic`}
                              onPress={() => onToggleTopicRole(role.id)}
                              className="rounded-[10px] border border-border-strong px-3 py-1.5 active:bg-surface-raised disabled:opacity-50"
                            >
                              <Text className="text-[14px] text-foreground">Remove</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      ))}
                      {canManageRoles ? (
                        pickerOpen ? (
                          <View className="gap-1 py-1">
                            {addable.map((role) => (
                              <Pressable
                                key={role.id}
                                accessibilityRole="button"
                                accessibilityLabel={`Add ${role.name} to the topic`}
                                onPress={() => onToggleTopicRole(role.id)}
                                className="flex-row items-center gap-2 rounded-xl border border-border-strong px-2 py-1.5 active:bg-surface-raised disabled:opacity-50"
                              >
                                <Text numberOfLines={1} className="min-w-0 flex-1 text-[14px]">
                                  {role.name}
                                </Text>
                                <Text className="text-[12px] text-muted-foreground">
                                  {role.members.length}
                                </Text>
                              </Pressable>
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
                        ) : addable.length > 0 ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Add roles to the topic"
                            onPress={() => setPickerOpen(true)}
                            className="self-start rounded-full bg-accent px-4 py-2 active:opacity-90 disabled:opacity-50"
                          >
                            <Text className="text-[14px] font-semibold text-accent-foreground">
                              Add roles
                            </Text>
                          </Pressable>
                        ) : null
                      ) : null}
                      {canManageRoles ? (
                        approverOpen ? (
                          <View className="gap-1 py-1">
                            <Pressable
                              accessibilityRole="radio"
                              accessibilityState={{ selected: approverRole === null }}
                              accessibilityLabel="Approvers: owner and admins only"
                              onPress={() => {
                                setApproverOpen(false);
                                onPickApprover(null);
                              }}
                              className="flex-row items-center gap-2 rounded-xl border border-border-strong px-2 py-1.5 active:bg-surface-raised disabled:opacity-50"
                            >
                              <Text numberOfLines={1} className="min-w-0 flex-1 text-[14px]">
                                Owner and admins only{approverRole === null ? ' ✓' : ''}
                              </Text>
                            </Pressable>
                            {roles.map((role) => (
                              <Pressable
                                key={role.id}
                                accessibilityRole="radio"
                                accessibilityState={{ selected: approverRole?.id === role.id }}
                                accessibilityLabel={`Approvers: ${role.name}`}
                                onPress={() => {
                                  setApproverOpen(false);
                                  onPickApprover(role.id);
                                }}
                                className="flex-row items-center gap-2 rounded-xl border border-border-strong px-2 py-1.5 active:bg-surface-raised disabled:opacity-50"
                              >
                                <Text numberOfLines={1} className="min-w-0 flex-1 text-[14px]">
                                  {role.name}
                                  {approverRole?.id === role.id ? ' ✓' : ''}
                                </Text>
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
                      ) : line !== undefined ? (
                        <Text className="py-1 text-[13px] text-muted-foreground">{line}</Text>
                      ) : null}
                    </View>
                  )}
                </View>
              ) : (
                <Text className="text-[13px] text-muted-foreground">
                  Roles are only available on private topics.
                </Text>
              )}

              <View className="flex-row justify-end gap-2">
                {topic.visibility === 'private' && isMember && !topic.isGeneral ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Leave topic"
                    disabled={busy}
                    onPress={onLeave}
                    className="rounded-[10px] px-4 py-2 active:bg-surface-raised disabled:opacity-50"
                  >
                    <Text className="text-[15px] text-foreground">Leave</Text>
                  </Pressable>
                ) : null}
                {canArchive ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Archive topic"
                    disabled={busy}
                    onPress={onArchive}
                    className="rounded-[10px] bg-danger px-4 py-2 active:opacity-80 disabled:opacity-50"
                  >
                    <Text className="text-[15px] font-semibold text-accent-foreground">
                      {busy ? 'Working…' : 'Archive'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
