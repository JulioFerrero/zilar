import type { ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { CheckCircle2, Plus, RotateCcw } from 'lucide-react';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { AiMemoryDialog } from './ais/AiMemoryDialog';
import { FieldError } from './ais/AiPageShell';
import { ConfirmDialog } from './ConfirmDialog';
import { PinsSection } from './PinsPanel';
import { TopicAddDialog, type AddAi, type AddPerson } from './panels/TopicAddDialog';
import { TopicAisSection } from './panels/TopicAisSection';
import { TopicHeader } from './panels/TopicHeader';
import { TopicMembersSection } from './panels/TopicMembersSection';
import { TopicRolesSection } from './panels/TopicRolesSection';
import { TopicToolsRow } from './panels/TopicToolsRow';
import { failInline } from './panels/topic-failure';
import { storeCall, useTopicPanelOps } from './panels/topicPanelOps';
import { TopicLinkRow } from './topic/TopicLinkRow';
import { TopicMuteLeave } from './topic/TopicMuteLeave';
import { Button } from './ui/button';
import { ListRow } from './ui/list-row';
import { Sheet } from './ui/sheet';
import { AlwaysAllowedList } from './approvals/AlwaysAllowedList';

function TopicDangerZone({
  isManager,
  isPrivate,
  visibilityBusy,
  archiving,
  onMakePublic,
  onMakePrivate,
  onArchive,
}: {
  isManager: boolean;
  isPrivate: boolean;
  visibilityBusy: boolean;
  archiving: boolean;
  onMakePublic: () => void;
  onMakePrivate: () => void;
  onArchive: () => void;
}) {
  return (
    <section aria-label="Danger zone" className="flex flex-col gap-2 px-2">
      {isManager && (
        <>
          {isPrivate ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="self-start rounded-full px-4"
              disabled={visibilityBusy}
              onClick={onMakePublic}
            >
              Make public
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="self-start rounded-full px-4"
              disabled={visibilityBusy}
              onClick={onMakePrivate}
            >
              {visibilityBusy ? 'Saving…' : 'Make private'}
            </Button>
          )}
          <Button
            type="button"
            variant="destructive"
            size="lg"
            className="self-start rounded-full px-4"
            disabled={archiving}
            onClick={onArchive}
          >
            Archive topic
          </Button>
        </>
      )}
    </section>
  );
}

function TopicRulesSection({
  groupId,
  topicId,
  topicName,
}: {
  groupId: string;
  topicId: string;
  topicName: string;
}) {
  return (
    <section aria-label={`Always allowed in ${topicName}`}>
      <AlwaysAllowedList scope={{ groupId }} topicId={topicId} topicName={topicName} readOnly />
    </section>
  );
}

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
    addDialogOpen,
    setAddDialogOpen,
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
    createInvite,
    leaveState,
    runLeave,
    archiveState,
    runArchive,
    visibilityState,
    runVisibility,
  } = useTopicPanelOps({ chat, topic, onClose });

  const contacts = useChatSelector((s) => s.contacts);

  const isPrivate = topic.visibility === 'private';
  const topicId = topic.id;
  const groupMembers = info?.members ?? [];
  const addableMembers = groupMembers.filter(
    (member) =>
      member.userId !== me && !membersState.members.some((item) => item.userId === member.userId),
  );
  const groupAis = info?.ais ?? [];
  const myAisInGroup = myAis.filter((ai) => groupAis.some((item) => item.aiId === ai.id));
  const addableAis = myAisInGroup.filter((ai) => !aisState.ais.some((item) => item.id === ai.id));

  // Contacts and other AIs only count as outside the group after the group info loads; before that the list is empty.
  const contactsNotInGroup =
    info === undefined
      ? []
      : contacts.filter((contact) => !groupMembers.some((m) => m.userId === contact.userId));
  const otherAis =
    info === undefined ? [] : myAis.filter((ai) => !groupAis.some((item) => item.aiId === ai.id));
  const addDialogPeople: AddPerson[] = [
    ...addableMembers.map((member) => ({
      id: member.userId,
      name: member.name,
      ...(member.avatarUrl === undefined ? {} : { avatarUrl: member.avatarUrl }),
      ...(member.handle === undefined ? {} : { handle: member.handle }),
      inGroup: true,
    })),
    ...(isManager
      ? contactsNotInGroup.map((contact) => ({
          id: contact.userId,
          name: contact.name,
          ...(contact.avatarUrl === undefined ? {} : { avatarUrl: contact.avatarUrl }),
          ...(contact.handle === undefined ? {} : { handle: contact.handle }),
          inGroup: false,
        }))
      : []),
  ];
  const addDialogAis: AddAi[] = [
    ...addableAis.map((ai) => ({
      id: ai.id,
      name: ai.name,
      ...(ai.avatarUrl === undefined ? {} : { avatarUrl: ai.avatarUrl }),
      inGroup: true,
    })),
    ...(isManager
      ? otherAis.map((ai) => ({
          id: ai.id,
          name: ai.name,
          ...(ai.avatarUrl === undefined ? {} : { avatarUrl: ai.avatarUrl }),
          inGroup: false,
        }))
      : []),
  ];
  const aiOwnerLabel = (aiId: string): string | undefined => {
    const ownerId = groupAis.find((item) => item.aiId === aiId)?.ownerId;
    if (ownerId === undefined) {
      return undefined;
    }
    if (ownerId === me) {
      return 'yours';
    }
    const name = groupMembers.find((member) => member.userId === ownerId)?.name;
    return name === undefined ? undefined : `${name}'s`;
  };
  const canRemoveAi = (aiId: string): boolean => {
    if (topic.isGeneral === true) {
      return false;
    }
    const ownerId = groupAis.find((item) => item.aiId === aiId)?.ownerId;
    return ownerId === me || isManager;
  };
  // AIs count as members; the count waits for both lists so it never jumps.
  const headerSuffix =
    topic.isGeneral === true
      ? ' · Everyone'
      : membersState.status === 'ready' && aisState.status === 'ready'
        ? ` · ${membersState.members.length + aisState.ais.length} members`
        : '';
  const visibilityBusy = isWaiting(visibilityState);
  // Any member who can see the topic may mark it done or reopen it.
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

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 *:shrink-0">
          <Button
            type="button"
            className="h-10 w-full text-[14px]"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add people or AIs
          </Button>

          <TopicAisSection
            state={aisState}
            pictureOf={(aiId) => groupAis.find((item) => item.aiId === aiId)?.avatarUrl}
            ownerLabelOf={aiOwnerLabel}
            canRemove={canRemoveAi}
            onRetry={() => refreshAis()}
            onOpenMemory={setMemoryAi}
            removeAi={removeAi}
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

          <TopicMembersSection
            listsMembers={topic.isGeneral !== true}
            state={membersState}
            groupMembers={groupMembers}
            allMembersText={`Everyone in ${groupTitle} can read and write here.`}
            me={me}
            isManager={isManager}
            onRetry={() => refreshMembers()}
            removeMember={removeMember}
            onError={setErrorMessage}
          />

          {chat.groupId !== undefined && (
            <TopicToolsRow
              topicId={topicId}
              groupId={chat.groupId}
              isManager={isManager}
              toolsCount={toolsCount}
            />
          )}

          <section aria-label="Topic" className="flex flex-col gap-1">
            <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Topic</h2>
            <TopicLinkRow chat={chat} onError={setErrorMessage} />
            {topic.isGeneral !== true && (
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
            )}
          </section>

          {chat.groupId !== undefined && (
            <TopicRulesSection groupId={chat.groupId} topicId={topic.id} topicName={chat.title} />
          )}

          {isPrivate && chat.groupId !== undefined && (
            <TopicRolesSection
              chatId={chat.id}
              topicId={topic.id}
              groupId={chat.groupId}
              isManager={isManager}
            />
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

          <TopicMuteLeave
            chat={chat}
            groupTitle={groupTitle}
            leaving={isWaiting(leaveState)}
            onLeave={() => runLeave()}
          />

          {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}
        </div>

        {/* The Add dialog is a child of the Sheet, like the confirms,
            so Escape closes only the topmost overlay. */}
        {addDialogOpen && (
          <TopicAddDialog
            topicName={chat.title}
            groupTitle={groupTitle}
            isManager={isManager}
            people={addDialogPeople}
            ais={addDialogAis}
            addMember={addMember}
            addAi={addAi}
            createInvite={createInvite}
            onClose={() => setAddDialogOpen(false)}
          />
        )}

        {/* The confirms are React children of the Sheet,
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
