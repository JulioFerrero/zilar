import { AiMemorySheet } from '@/components/ais/ai-memory-sheet';
import { TopicInfoSheet } from '@/components/chat/topic-sheets';
import type { ChatScreen } from '@/components/chat/use-chat-screen';
import { runInBackground } from '@/lib/effect/run-in-background';
import { attachedRoleIds, describeRolesError, mayManageRoles } from '@/lib/roles';
import { useChatStore } from '@/store/chat-store-provider';
import type { ChatSummary } from '@/lib/types';

type TopicInfoHostProps = {
  screen: ChatScreen;
  chat: ChatSummary;
};

/** The topic-info sheet and the AI-memory sheet it opens, for the topic branch. */
export function TopicInfoHost({ screen, chat }: TopicInfoHostProps) {
  const removeTopicMember = useChatStore((state) => state.removeTopicMember);
  const patchTopic = useChatStore((state) => state.patchTopic);
  const setTopicRoles = useChatStore((state) => state.setTopicRoles);
  const refreshTopicRoles = useChatStore((state) => state.refreshTopicRoles);
  const refreshGroupRoles = useChatStore((state) => state.refreshGroupRoles);

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
      onSuccess: () => screen.setInfoOpen(false),
      onFailure: () => screen.setInfoError('Could not leave the topic. Try again.'),
      onSettled: () => screen.setInfoBusy(false),
    });
  };

  const onArchive = () => {
    screen.setInfoBusy(true);
    screen.setInfoError('');
    runInBackground(() => patchTopic(chat.id, { archived: true }), {
      onSuccess: () => screen.setInfoOpen(false),
      onFailure: () => screen.setInfoError('Could not archive the topic. Try again.'),
      onSettled: () => screen.setInfoBusy(false),
    });
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
        members={screen.infoMembers}
        ais={screen.infoAis}
        aiCount={screen.infoAis.length}
        canArchive={screen.canArchiveInfo}
        isMember={screen.isPrivateMember}
        busy={screen.infoBusy}
        error={screen.infoError}
        onLeave={onLeave}
        onArchive={onArchive}
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
        onToggleTopicRole={toggleTopicRole}
        onPickApprover={(roleId) =>
          saveTopicRoles(attachedRoleIds(screen.topicRoles?.roles ?? []), roleId)
        }
        onRetryRoles={onRetryRoles}
        onRetryGroupRoles={onRetryGroupRoles}
        onOpenAiMemory={(ai) => {
          screen.setInfoOpen(false);
          screen.setMemoryAi(ai);
        }}
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
