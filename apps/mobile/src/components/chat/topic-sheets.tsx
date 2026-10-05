import { Lock } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/chat/avatar';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { MUTE_DURATIONS, type MuteDurationId } from '@/lib/chat-prefs';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { approverLine, approverOptions, topicAccessRows } from '@/lib/roles';
import type { CustomGroupRole } from '@/lib/roles-api';
import type { ApproverRole, TopicMember, TopicRole } from '@/lib/topics-api';
import type { ChatSummary } from '@/lib/types';
import { useColorScheme } from 'nativewind';

export type TopicSheetAction = 'archive';
export type TopicPrefAction =
  | { kind: 'mute'; duration: MuteDurationId }
  | { kind: 'unmute' }
  | { kind: 'pin'; pinned: boolean }
  | { kind: 'archive'; archived: boolean };

/**
 * The long-press sheet on a topic row (T-0112, extended in T-0135): Pin /
 * Unpin, Mute with the durations (Unmute when muted), Archive chat /
 * Unarchive for the per-user archive, plus Archive topic for everyone for
 * managers (never General — the caller hides it). Pure view (no hooks) so
 * it stays render-testable like `ReactionChips`: the screen owns the mute
 * submenu and performs the actions.
 */
export function TopicActionsSheet({
  chat,
  canArchive,
  muteOpen,
  onOpenMute,
  onAction,
  onPref,
  onClose,
}: {
  chat: ChatSummary | null;
  canArchive: boolean;
  muteOpen: boolean;
  onOpenMute: () => void;
  onAction: (action: TopicSheetAction) => void;
  onPref: (action: TopicPrefAction) => void;
  onClose: () => void;
}) {
  const pinned = chat?.pinnedAt !== undefined;
  const archived = chat?.archived === true;
  const muted = chat?.muted === true;
  return (
    <Modal visible={chat !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close topic actions"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40 px-2"
        style={{ paddingBottom: 16 }}
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
              {chat.topic?.visibility === 'private' ? <Lock size={16} color="#8a8a8a" /> : null}
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={pinned ? 'Unpin topic' : 'Pin topic'}
            onPress={() => onPref({ kind: 'pin', pinned: !pinned })}
            className="border-b border-divider px-4 py-3.5 active:bg-surface-raised"
          >
            <Text className="text-[16px] text-foreground">{pinned ? 'Unpin' : 'Pin'}</Text>
          </Pressable>
          {muteOpen ? (
            <>
              {MUTE_DURATIONS.map((option) => (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Mute for ${option.label.toLowerCase()}`}
                  onPress={() => onPref({ kind: 'mute', duration: option.id })}
                  className="border-b border-divider px-4 py-3 active:bg-surface-raised"
                >
                  <Text className="text-[16px] text-foreground">{option.label}</Text>
                </Pressable>
              ))}
              {muted ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Unmute topic"
                  onPress={() => onPref({ kind: 'unmute' })}
                  className="border-b border-divider px-4 py-3 active:bg-surface-raised"
                >
                  <Text className="text-[16px] text-foreground">Unmute</Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mute topic"
              onPress={onOpenMute}
              className="border-b border-divider px-4 py-3.5 active:bg-surface-raised"
            >
              <Text className="text-[16px] text-foreground">
                {muted ? 'Muted: change' : 'Mute'}
              </Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={archived ? 'Unarchive chat' : 'Archive chat'}
            onPress={() => onPref({ kind: 'archive', archived: !archived })}
            className="border-b border-divider px-4 py-3.5 active:bg-surface-raised"
          >
            <Text className="text-[16px] text-foreground">
              {archived ? 'Unarchive' : 'Archive'}
            </Text>
          </Pressable>
          {canArchive ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Archive topic for everyone"
              onPress={() => onAction('archive')}
              className="px-4 py-3.5 active:bg-surface-raised"
            >
              <Text className="text-[16px] text-danger">Archive topic for everyone</Text>
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
  rolesLoading,
  groupRolesError,
  approverRole,
  groupRoles,
  canManageRoles,
  onToggleTopicRole,
  onPickApprover,
  onRetryRoles,
  onRetryGroupRoles,
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
}) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const insets = useSafeAreaInsets();
  const topic = chat?.topic;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [approverOpen, setApproverOpen] = useState(false);
  const isPrivate = topic?.visibility === 'private';
  // The picker rows and approver options come from the shared helpers, so
  // the sheet renders exactly what the unit tests pin (attached first, the
  // rest sorted by name).
  const accessRows = topicAccessRows(topic?.visibility ?? 'public', roles, groupRoles);
  const attachedRows = accessRows.filter((row) => row.attached);
  const addableRows = accessRows.filter((row) => !row.attached);
  const approverOpts = approverOptions(roles, approverRole);
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
                  ) : rolesLoading ? (
                    <Text className="py-1 text-[14px] text-muted-foreground">
                      Checking your role…
                    </Text>
                  ) : (
                    <View>
                      {roles.length === 0 ? (
                        <Text className="py-1 text-[14px] text-muted-foreground">
                          No roles here yet — only the people above can see this topic.
                        </Text>
                      ) : null}
                      {attachedRows.map((row) => (
                        <View key={row.id} className="flex-row items-center gap-2 py-1">
                          <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px]">
                            {row.label}
                          </Text>
                          {canManageRoles ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Remove ${row.label} from the topic`}
                              onPress={() => onToggleTopicRole(row.id)}
                              className="rounded-[10px] border border-border-strong px-3 py-1.5 active:bg-surface-raised disabled:opacity-50"
                            >
                              <Text className="text-[14px] text-foreground">Remove</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      ))}
                      {groupRolesError !== '' ? (
                        <View className="gap-2 py-1">
                          <Text accessibilityRole="alert" className="text-[13px] text-danger">
                            {groupRolesError}
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Retry loading group roles"
                            onPress={onRetryGroupRoles}
                            className="self-start rounded-[10px] border border-border-strong px-4 py-2 active:bg-surface-raised disabled:opacity-50"
                          >
                            <Text className="text-[14px] text-foreground">Retry</Text>
                          </Pressable>
                        </View>
                      ) : null}
                      {canManageRoles ? (
                        pickerOpen ? (
                          <View className="gap-1 py-1">
                            {addableRows.map((row) => (
                              <Pressable
                                key={row.id}
                                accessibilityRole="button"
                                accessibilityLabel={`Add ${row.label} to the topic`}
                                onPress={() => onToggleTopicRole(row.id)}
                                className="flex-row items-center gap-2 rounded-xl border border-border-strong px-2 py-1.5 active:bg-surface-raised disabled:opacity-50"
                              >
                                <Text numberOfLines={1} className="min-w-0 flex-1 text-[14px]">
                                  {row.label}
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
                        ) : addableRows.length > 0 ? (
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
                                  {option.selected ? ' ✓' : ''}
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
