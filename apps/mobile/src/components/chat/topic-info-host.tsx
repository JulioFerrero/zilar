import { useRouter } from 'expo-router';
import { useState } from 'react';

import { AiMemorySheet } from '@/components/ais/ai-memory-sheet';
import { LeaveTopicSheet } from '@/components/chat/leave-topic-sheet';
import { TopicAddSheet } from '@/components/chat/topic-add-sheet';
import { TopicInfoSheet } from '@/components/chat/topic-info-sheet';
import type { ChatScreen } from '@/components/chat/use-chat-screen';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { runInBackground } from '@/lib/effect/run-in-background';
import { attachedRoleIds, describeRolesError, mayManageRoles } from '@/lib/roles';
import { useChatStore } from '@/store/chat-store-provider';
import type { ChatSummary } from '@/lib/types';

type TopicInfoHostProps = {
  screen: ChatScreen;
  chat: ChatSummary;
};

export function TopicInfoHost({ screen, chat }: TopicInfoHostProps) {
  const router = useRouter();
  const removeTopicMember = useChatStore((state) => state.removeTopicMember);
  const patchTopic = useChatStore((state) => state.patchTopic);
  const setTopicRoles = useChatStore((state) => state.setTopicRoles);
  const refreshTopicRoles = useChatStore((state) => state.refreshTopicRoles);
  const refreshGroupRoles = useChatStore((state) => state.refreshGroupRoles);
  const contacts = useChatStore((state) => state.contacts);
  const ownedAis = useChatStore((state) => state.ownedAis);
  const addTopicMember = useChatStore((state) => state.addTopicMember);
  const addTopicAi = useChatStore((state) => state.addTopicAi);

  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  // One native sheet is presented at a time: the Add sheet replaces the info sheet (Close returns to the topic), like the AI memory sheet.
  const [addOpen, setAddOpen] = useState(false);
  const isManager = mayManageRoles(
    screen.detail?.members.find((member) => member.userId === screen.myUserId)?.role,
  );
  // The topic's own Tools and routines page, only when the group behind it is known (the manager bit reads the group's members).
  const toolsGroupId = screen.chatGroupId;
  const toolsTopicId = chat.topic?.id;
  const openTools =
    toolsGroupId === undefined || toolsTopicId === undefined
      ? undefined
      : () => {
          screen.setInfoOpen(false);
          router.push({
            pathname: '/topic-tools/[id]',
            params: { id: toolsTopicId, group: toolsGroupId },
          });
        };

  const saveTopicRoles = (roleIds: string[], approverRoleId: string | null): void => {
    screen.setInfoRolesError('');
    // Writes map 403 and 404 to the neutral denied line (the server answers
    // the same 404 for unknown and hidden ids); nothing raw reaches the UI.
    runInBackground(() => setTopicRoles(chat.id, { roleIds, approverRoleId }), {
      onFailure: (error) => screen.setInfoRolesError(describeRolesError(error, 'write')),
    });
  };

  const toggleTopicRole = (roleId: string): void => {
    const attached = screen.topicRoles?.roles ?? [];
    const next = attached.some((role) => role.id === roleId)
      ? attached.filter((role) => role.id !== roleId).map((role) => role.id)
      : [...attached.map((role) => role.id), roleId];
    saveTopicRoles(next, screen.topicRoles?.approverRole?.id ?? null);
  };

  const onLeave = () => {
    screen.setInfoBusy(true);
    screen.setInfoError('');
    runInBackground(() => removeTopicMember(chat.id, screen.myUserId), {
      onSuccess: () => {
        screen.setInfoOpen(false);
        setConfirmingLeave(false);
      },
      onFailure: () => screen.setInfoError('Could not leave the topic. Try again.'),
      onSettled: () => screen.setInfoBusy(false),
    });
  };

  const onAskLeave = () => {
    screen.setInfoError('');
    screen.setInfoOpen(false);
    setConfirmingLeave(true);
  };

  const onArchive = () => {
    screen.setInfoBusy(true);
    screen.setInfoError('');
    runInBackground(() => patchTopic(chat.id, { archived: true }), {
      onSuccess: () => setConfirmingArchive(false),
      onFailure: () => screen.setInfoError('Could not archive the topic. Try again.'),
      onSettled: () => screen.setInfoBusy(false),
    });
  };

  const onAskArchive = () => {
    screen.setInfoError('');
    screen.setInfoOpen(false);
    setConfirmingArchive(true);
  };

  const onRetryRoles = () => {
    screen.setInfoRolesError('');
    runInBackground(() => refreshTopicRoles(chat.id), {
      onFailure: (error) => screen.setInfoRolesError(describeRolesError(error, 'load')),
    });
  };

  const onRetryGroupRoles = () => {
    const groupId = screen.chatGroupId;
    screen.setInfoGroupRolesError('');
    if (groupId !== undefined) {
      runInBackground(() => refreshGroupRoles(groupId), {
        onFailure: (error) => screen.setInfoGroupRolesError(describeRolesError(error, 'load')),
      });
    }
  };

  return (
    <>
      <TopicInfoSheet
        chat={screen.infoOpen ? chat : null}
        groupTitle={screen.groupName}
        detail={screen.detail}
        myUserId={screen.myUserId}
        canArchive={screen.canArchiveInfo}
        busy={screen.infoBusy}
        error={screen.infoError}
        onAskLeave={onAskLeave}
        onArchive={onAskArchive}
        onClose={() => {
          if (!screen.infoBusy) {
            screen.setInfoOpen(false);
          }
        }}
        roles={screen.topicRoles?.roles ?? []}
        rolesError={screen.infoRolesError}
        rolesLoading={!screen.detailLoaded && screen.infoRolesError === ''}
        groupRolesError={screen.infoGroupRolesError}
        approverRole={screen.topicRoles?.approverRole ?? null}
        groupRoles={screen.groupRoles ?? []}
        canManageRoles={mayManageRoles(
          screen.detail?.members.find((member) => member.userId === screen.myUserId)?.role,
        )}
        onAdd={() => {
          screen.setInfoOpen(false);
          setAddOpen(true);
        }}
        onOpenTools={openTools}
        onToggleTopicRole={toggleTopicRole}
        onPickApprover={(roleId) =>
          saveTopicRoles(attachedRoleIds(screen.topicRoles?.roles ?? []), roleId)
        }
        onRetryRoles={onRetryRoles}
        onRetryGroupRoles={onRetryGroupRoles}
        patch={screen.patch}
        patchError={screen.topicError}
        onPatchError={screen.setTopicError}
        onOpenAiMemory={(ai) => {
          screen.setInfoOpen(false);
          screen.setMemoryAi(ai);
        }}
      />
      <LeaveTopicSheet
        chat={confirmingLeave ? chat : null}
        groupTitle={screen.groupName}
        busy={screen.infoBusy}
        error={screen.infoError}
        onCancel={() => {
          if (!screen.infoBusy) {
            setConfirmingLeave(false);
            screen.setInfoError('');
          }
        }}
        onLeave={onLeave}
      />
      <TopicAddSheet
        chat={addOpen ? chat : null}
        groupTitle={screen.groupName}
        detail={screen.detail}
        myUserId={screen.myUserId}
        isManager={isManager}
        contacts={contacts}
        ownedAis={ownedAis}
        addMember={(userId) => addTopicMember(chat.id, userId)}
        addAi={(aiId) => addTopicAi(chat.id, aiId)}
        onClose={() => setAddOpen(false)}
      />
      <ConfirmDialog
        visible={confirmingArchive}
        title={`Archive “${chat.title}” for everyone?`}
        message="The topic disappears from the list for everyone. Its history stays on the server."
        error={screen.infoError}
        confirmLabel="Archive"
        busyLabel="Archiving…"
        busy={screen.infoBusy}
        onCancel={() => {
          if (!screen.infoBusy) {
            setConfirmingArchive(false);
            screen.setInfoError('');
          }
        }}
        onConfirm={onArchive}
      />
      <AiMemorySheet
        api={screen.memoryApi}
        chat={chat.id}
        ai={screen.memoryAi}
        onClose={() => screen.setMemoryAi(null)}
      />
    </>
  );
}
