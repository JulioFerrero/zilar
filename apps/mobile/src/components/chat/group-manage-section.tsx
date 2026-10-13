import { useRouter } from 'expo-router';
import { Effect } from 'effect';
import { useState } from 'react';
import { View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { rawCall } from '@/components/chat/group-action';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { goBackOrHome } from '@/lib/navigation';
import { useChatStore } from '@/store/chat-store-provider';

/** One member the owner may hand the group to. */
export interface ManageMember {
  userId: string;
  name: string;
}

/** The owner/non-owner controls the screen performs (T-1251). */
export interface GroupManageProps {
  /** Whether the viewer owns the group: owners cannot leave, and only they
   *  hand it over or delete it. */
  isOwner: boolean;
  /** True while a manage write runs: every control disables. */
  busy: boolean;
  /** The last manage failure, shown as one line; empty when none. */
  error: string;
  /** Leaves the group: the screen runs `leaveChannel` and navigates away. */
  onLeave: () => void;
  /** Hands the group to one member: the screen runs `transferGroupOwner`. */
  onTransferOwner: (userId: string) => void;
  /** Deletes the group for everyone: the screen runs `deleteGroup`. */
  onDelete: () => void;
}

/**
 * The screen's manage wiring (T-1251): owns the busy/error flags and runs the
 * store actions. Leave and delete leave the screen with `goBackOrHome`; handing
 * the group over reloads the detail in the store, so the caller repaints as an
 * admin and `Leave group` appears. A failure shows one fixed sentence, never
 * the raw server text.
 */
export function useGroupManage(input: {
  groupId: string;
  groupChatId: string;
  isOwner: boolean;
}): GroupManageProps {
  const router = useRouter();
  const leaveChannel = useChatStore((state) => state.leaveChannel);
  const transferGroupOwner = useChatStore((state) => state.transferGroupOwner);
  const deleteGroup = useChatStore((state) => state.deleteGroup);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const runWrite = (work: () => Promise<unknown>, fallback: string, after: () => void): void => {
    setBusy(true);
    setError('');
    void Effect.runPromise(
      rawCall(work).pipe(
        Effect.tap(() => Effect.sync(after)),
        Effect.catch(() => Effect.sync(() => setError(fallback))),
        Effect.ensuring(Effect.sync(() => setBusy(false))),
      ),
    );
  };

  return {
    isOwner: input.isOwner,
    busy,
    error,
    onLeave: () =>
      runWrite(
        () => leaveChannel(input.groupChatId),
        'Could not leave the group.',
        () => goBackOrHome(router),
      ),
    onTransferOwner: (userId: string) =>
      runWrite(
        () => transferGroupOwner(input.groupId, userId),
        'Could not hand over the group.',
        () => {},
      ),
    onDelete: () =>
      runWrite(
        () => deleteGroup(input.groupId),
        'Could not delete the group.',
        () => goBackOrHome(router),
      ),
  };
}

/**
 * The group's manage section (T-1251), appended to the members-and-roles
 * sheet: Leave group for a non-owner, and Make owner (a member picker) plus
 * Delete group (a typed-name confirm) for the owner. Thin view: local confirm
 * state only, the screen runs the store actions and the navigation. Never
 * `Alert.alert`.
 */
export function GroupManageSection({
  groupTitle,
  isOwner,
  members,
  busy,
  error,
  onLeave,
  onTransferOwner,
  onDelete,
}: GroupManageProps & {
  groupTitle: string;
  /** The members the owner may hand the group to (never the owner themself). */
  members: ManageMember[];
}) {
  const [leaveConfirming, setLeaveConfirming] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [transferId, setTransferId] = useState<string | undefined>(undefined);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteName, setDeleteName] = useState('');

  const targetName = (userId: string): string =>
    members.find((member) => member.userId === userId)?.name ?? '';

  return (
    <View className="pt-3">
      <Text accessibilityRole="header" className="text-[13px] font-semibold text-muted-foreground">
        Manage
      </Text>

      {isOwner ? (
        <>
          <Text className="py-1 text-[13px] text-muted-foreground">
            Owners can&apos;t leave. Make someone else owner first.
          </Text>
          {transferId !== undefined ? (
            <View className="gap-1 py-1">
              <Text className="text-[13px] text-muted-foreground">
                Make {targetName(transferId)} the owner? You become an admin.
              </Text>
              <View className="flex-row gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  accessibilityLabel={`Confirm making ${targetName(transferId)} the owner`}
                  disabled={busy}
                  onPress={() => onTransferOwner(transferId)}
                >
                  <Text>Make owner</Text>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  accessibilityLabel="Cancel making the owner"
                  disabled={busy}
                  onPress={() => setTransferId(undefined)}
                >
                  <Text>Cancel</Text>
                </Button>
              </View>
            </View>
          ) : pickerOpen ? (
            <View className="py-1">
              {members.length === 0 ? (
                <Text className="py-1 text-[13px] text-muted-foreground">
                  There is no one else to hand the group to.
                </Text>
              ) : (
                members.map((member) => (
                  <View key={member.userId} className="flex-row items-center gap-2 py-1.5">
                    <EntityAvatar person={member} size={28} />
                    <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] text-foreground">
                      {member.name}
                    </Text>
                    <Button
                      variant="ghost"
                      size="sm"
                      accessibilityLabel={`Make ${member.name} the owner`}
                      disabled={busy}
                      onPress={() => {
                        setPickerOpen(false);
                        setTransferId(member.userId);
                      }}
                    >
                      <Text>Make owner</Text>
                    </Button>
                  </View>
                ))
              )}
              <Button
                variant="ghost"
                size="sm"
                accessibilityLabel="Cancel making the owner"
                disabled={busy}
                onPress={() => setPickerOpen(false)}
                className="self-start"
              >
                <Text>Cancel</Text>
              </Button>
            </View>
          ) : (
            <Button
              variant="outline"
              size="lg"
              accessibilityLabel="Make owner"
              disabled={busy}
              onPress={() => setPickerOpen(true)}
              className="self-start"
            >
              <Text>Make owner</Text>
            </Button>
          )}

          <View className="pt-3">
            {deleteConfirming ? (
              <View className="gap-2 rounded-[10px] border border-border-strong bg-surface-raised px-3 py-2">
                <Text className="text-[13px] text-muted-foreground">
                  Delete {groupTitle} for everyone? All topics and messages go away. This can&apos;t
                  be undone.
                </Text>
                <TextField
                  value={deleteName}
                  onChangeText={setDeleteName}
                  placeholder={groupTitle}
                  accessibilityLabel="Type the group name to confirm"
                />
                <View className="flex-row items-center gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    accessibilityLabel="Delete group"
                    disabled={busy || deleteName.trim() !== groupTitle}
                    onPress={onDelete}
                  >
                    <Text>Delete group</Text>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    accessibilityLabel="Cancel deleting the group"
                    disabled={busy}
                    onPress={() => {
                      setDeleteConfirming(false);
                      setDeleteName('');
                    }}
                  >
                    <Text>Cancel</Text>
                  </Button>
                </View>
              </View>
            ) : (
              <Button
                variant="destructive"
                size="lg"
                accessibilityLabel="Delete group"
                disabled={busy}
                onPress={() => setDeleteConfirming(true)}
                className="self-start"
              >
                <Text>Delete group</Text>
              </Button>
            )}
          </View>
        </>
      ) : (
        <>
          <View className="flex-row items-center gap-2 py-2">
            <Button
              variant={leaveConfirming ? 'destructive' : 'outline'}
              size="lg"
              accessibilityLabel={leaveConfirming ? 'Confirm leaving the group' : 'Leave group'}
              disabled={busy}
              onPress={() => (leaveConfirming ? onLeave() : setLeaveConfirming(true))}
            >
              <Text>{leaveConfirming ? 'Leave' : 'Leave group'}</Text>
            </Button>
            {leaveConfirming ? (
              <Button
                variant="ghost"
                size="lg"
                accessibilityLabel="Cancel leaving the group"
                disabled={busy}
                onPress={() => setLeaveConfirming(false)}
              >
                <Text>Cancel</Text>
              </Button>
            ) : null}
          </View>
          {leaveConfirming ? (
            <Text className="text-[13px] text-muted-foreground">
              Leave {groupTitle}? You can rejoin only with an invite.
            </Text>
          ) : null}
        </>
      )}
      {error !== '' ? (
        <Text accessibilityRole="alert" className="py-1 text-[13px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
