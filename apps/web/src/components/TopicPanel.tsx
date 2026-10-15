import type { ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { AiMemoryDialog } from './ais/AiMemoryDialog';
import { FieldError } from './ais/AiPageShell';
import { ConfirmDialog } from './ConfirmDialog';
import { PinsSection } from './PinsPanel';
import { TopicAisSection } from './panels/TopicAisSection';
import { TopicDangerZone } from './panels/TopicDangerZone';
import { TopicHeader } from './panels/TopicHeader';
import { TopicMembersSection } from './panels/TopicMembersSection';
import { TopicRolesSection } from './panels/TopicRolesSection';
import { TopicRulesSection } from './panels/TopicRulesSection';
import { failInline } from './panels/topic-failure';
import { storeCall, useTopicPanelOps } from './panels/topicPanelOps';
import { RoutinesSection } from './tools/RoutinesSection';
import { ToolsSection } from './tools/ToolsSection';
import { TopicLinkRow } from './topic/TopicLinkRow';
import { ListRow } from './ui/list-row';
import { Sheet } from './ui/sheet';

/**
 * The topic info panel (T-0111): visibility, members (private list with
 * Add/Remove for managers and Leave for a member; public shows "All N
 * members of the group"), AIs in the topic, the topic's Always-allowed
 * rules and tools count (read-only, rows show the topic name), Archive, and
 * Make public / Make private (private → public confirms with the
 * history-exposure warning).
 */
export function TopicPanel({
  chat,
  onOpenGroup,
  onClose,
}: {
  chat: ChatSummary;
  onOpenGroup?: () => void;
  onClose: () => void;
}) {
  const topic = chat.topic;
  if (topic === undefined) {
    return null;
  }
  return (
    <TopicPanelBody
      chat={chat}
      topic={topic}
      {...(onOpenGroup !== undefined ? { onOpenGroup } : {})}
      onClose={onClose}
    />
  );
}

function TopicPanelBody({
  chat,
  topic,
  onOpenGroup,
  onClose,
}: {
  chat: ChatSummary;
  topic: NonNullable<ChatSummary['topic']>;
  onOpenGroup?: () => void;
  onClose: () => void;
}) {
  const {
    storeApi,
    info,
    me,
    groupTitle,
    isManager,
    membersState,
    refreshMembers,
    aisState,
    refreshAis,
    toolsCount,
    myAis,
    memberPickerOpen,
    setMemberPickerOpen,
    aiPickerOpen,
    setAiPickerOpen,
    confirmingVisibility,
    setConfirmingVisibility,
    confirmingArchive,
    setConfirmingArchive,
    errorMessage,
    setErrorMessage,
    memoryAi,
    setMemoryAi,
    removeMember,
    addMember,
    removeAi,
    addAi,
    leaveState,
    runLeave,
    archiveState,
    runArchive,
    visibilityState,
    runVisibility,
  } = useTopicPanelOps({ chat, topic, onClose });

  const isPrivate = topic.visibility === 'private';
  const topicId = topic.id;
  const groupMembers = info?.members ?? [];
  const addableMembers = groupMembers.filter(
    (member) =>
      member.userId !== me && !membersState.members.some((item) => item.userId === member.userId),
  );
  const groupAis = info?.ais ?? [];
  // T-1492: AIs count as members, like in `GroupPanel`.
  const memberCount =
    info === undefined ? (chat.memberCount ?? 0) : info.members.length + info.ais.length;
  const myAisInGroup = myAis.filter((ai) => groupAis.some((item) => item.aiId === ai.id));
  const addableAis = myAisInGroup.filter((ai) => !aisState.ais.some((item) => item.id === ai.id));
  const aiOwnerName = (aiId: string): string => {
    const ownerId = groupAis.find((item) => item.aiId === aiId)?.ownerId;
    if (ownerId === undefined) {
      return 'someone';
    }
    if (ownerId === me) {
      return 'you';
    }
    return groupMembers.find((member) => member.userId === ownerId)?.name ?? 'someone';
  };
  const canRemoveAi = (aiId: string): boolean => {
    const ownerId = groupAis.find((item) => item.aiId === aiId)?.ownerId;
    return ownerId === me || isManager;
  };
  const headerSuffix =
    isPrivate && membersState.status === 'ready'
      ? ` · ${membersState.members.length} members`
      : !isPrivate && info !== undefined
        ? ` · All ${memberCount} members`
        : '';
  const iAmMember = membersState.members.some((member) => member.userId === me);
  const visibilityBusy = isWaiting(visibilityState);

  // T-1534: any member who can see the topic may mark it done or reopen it.
  // The store repaints the row from the server's answer, then `refreshChats`
  // updates the sidebar's mark.
  const [, runToggleDone] = useAction<void, void, never>(() =>
    Effect.sync(() => setErrorMessage('')).pipe(
      Effect.andThen(
        storeCall(() => storeApi.getState().patchTopic(chat.id, { done: topic.doneAt === null })),
      ),
      Effect.tap(() => Effect.sync(() => storeApi.getState().refreshChats())),
      Effect.catchTag('ApiFailure', failInline(setErrorMessage, 'Could not update the topic.')),
    ),
  );

  return (
    <>
      <Sheet open onClose={onClose} ariaLabel={`${chat.title} topic info`}>
        <TopicHeader
          chat={chat}
          visibility={topic.visibility}
          groupTitle={groupTitle}
          suffix={headerSuffix}
          {...(onOpenGroup !== undefined ? { onOpenGroup } : {})}
          onClose={onClose}
        />

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <TopicMembersSection
            isPrivate={isPrivate}
            state={membersState}
            groupMembers={groupMembers}
            addableMembers={addableMembers}
            allMembersText={`All ${memberCount} members of ${groupTitle} can read and write here.`}
            me={me}
            isManager={isManager}
            iAmMember={iAmMember}
            pickerOpen={memberPickerOpen}
            leaving={isWaiting(leaveState)}
            onPickerOpenChange={setMemberPickerOpen}
            onRetry={() => refreshMembers()}
            onLeave={() => runLeave()}
            removeMember={removeMember}
            addMember={addMember}
            onError={setErrorMessage}
          />

          {/* T-1534: the topic's link and its done switch. Every member who
              can see the topic may use both. */}
          <section aria-label="Topic" className="flex flex-col gap-1">
            <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Topic</h2>
            <TopicLinkRow chat={chat} onError={setErrorMessage} />
            <ListRow
              icon={
                topic.doneAt === null ? (
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                ) : (
                  <RotateCcw className="size-4" aria-hidden="true" />
                )
              }
              title={topic.doneAt === null ? 'Mark as done' : 'Reopen'}
              onClick={() => runToggleDone()}
            />
          </section>

          <TopicAisSection
            state={aisState}
            addableAis={addableAis}
            pictureOf={(aiId) => groupAis.find((item) => item.aiId === aiId)?.avatarUrl}
            ownerNameOf={aiOwnerName}
            canRemove={canRemoveAi}
            pickerOpen={aiPickerOpen}
            onPickerOpenChange={setAiPickerOpen}
            onRetry={() => refreshAis()}
            onOpenMemory={setMemoryAi}
            removeAi={removeAi}
            addAi={addAi}
            onError={setErrorMessage}
          />

          {memoryAi !== undefined && (
            <AiMemoryDialog
              chat={chat.id}
              aiId={memoryAi.id}
              aiName={memoryAi.name}
              onClose={() => setMemoryAi(undefined)}
            />
          )}

          {chat.groupId !== undefined && (
            <TopicRulesSection groupId={chat.groupId} topicId={topic.id} topicName={chat.title} />
          )}

          {/* T-0116: roles with access + the approver role, for private
              topics. Everyone sees the attached list; managers edit it. */}
          {isPrivate && chat.groupId !== undefined && (
            <TopicRolesSection
              chatId={chat.id}
              topicId={topic.id}
              groupId={chat.groupId}
              isManager={isManager}
            />
          )}

          {toolsCount !== null && (
            <p className="px-2 text-[13px] text-muted-foreground">
              {toolsCount} {toolsCount === 1 ? 'tool' : 'tools'} in this topic
            </p>
          )}

          {/* T-0107: tools and routines of this topic. Managers see the
              actions (run, revert, pause, resume, delete); members read. */}
          {chat.groupId !== undefined && (
            <>
              <ToolsSection
                scope={{ topicId }}
                scopeKey={`topic:${topicId}`}
                canManage={isManager}
              />
              <RoutinesSection
                scope={{ groupId: chat.groupId }}
                scopeKey={`topic-routines:${topicId}`}
                canManage={isManager}
              />
            </>
          )}

          <PinsSection chatId={chat.id} onOpen={() => storeApi.getState().setPinsPanel(chat.id)} />

          {topic.isGeneral !== true && (
            <TopicDangerZone
              isManager={isManager}
              isPrivate={isPrivate}
              visibilityBusy={visibilityBusy}
              archiving={isWaiting(archiveState)}
              onMakePublic={() => setConfirmingVisibility(true)}
              onMakePrivate={() => runVisibility()}
              onArchive={() => setConfirmingArchive(true)}
            />
          )}

          {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}
        </div>

        {/* T-1351: the confirms are React children of the Sheet, not siblings,
            so Base UI nests them and Escape closes only the confirm. */}
        {confirmingVisibility && topic.visibility === 'private' && (
          <ConfirmDialog
            title="Make this topic public?"
            body={`Everyone in ${groupTitle} will be able to read the whole history of “${chat.title}”, including messages sent while it was private.`}
            confirmLabel={visibilityBusy ? 'Making public…' : 'Make public'}
            onConfirm={() => runVisibility()}
            onCancel={() => setConfirmingVisibility(false)}
          />
        )}
        {confirmingArchive && (
          <ConfirmDialog
            title={`Archive “${chat.title}”?`}
            body="The topic disappears from the list for everyone. Its history stays on the server."
            confirmLabel={isWaiting(archiveState) ? 'Archiving…' : 'Archive'}
            onConfirm={() => runArchive()}
            onCancel={() => setConfirmingArchive(false)}
          />
        )}
      </Sheet>
    </>
  );
}
