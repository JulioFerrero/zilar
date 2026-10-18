import { ConfirmDialog } from './ConfirmDialog';
import { EntityAvatar } from './EntityAvatar';
import { RoutinesSection } from './tools/RoutinesSection';
import { ToolsSection } from './tools/ToolsSection';
import { Button } from './ui/button';
import { ListRow } from './ui/list-row';
import { Switch } from './ui/switch';
import { useMuteToggle } from './useMuteToggle';
import { AiMemoryDialog } from './ais/AiMemoryDialog';
import { FieldError } from './ais/AiPageShell';
import { AlwaysAllowedList } from './approvals/AlwaysAllowedList';
import { failInline } from './panels/topic-failure';
import { TopicAddDialog, type AddAi, type AddPerson } from './panels/TopicAddDialog';
import { TopicAisSection } from './panels/TopicAisSection';
import { TopicMembersSection } from './panels/TopicMembersSection';
import { storeCall, useTopicPanelOps } from './panels/topicPanelOps';
import { TopicRolesSection } from './panels/TopicRolesSection';
import { PinsSection } from './PinsPanel';
import { TopicLinkRow } from './topic/TopicLinkRow';
import { Sheet } from './ui/sheet';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { cn } from '@/lib/utils';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { type ChatSummary, isTopicJoined } from '@zilar/chat-core';
import { Effect } from 'effect';
import {
  CheckCircle2,
  Plus,
  RotateCcw,
  ChevronRight,
  Wrench,
  Lock,
  X,
  Bell,
  LogOut,
} from 'lucide-react';
import { useState } from 'react';

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

function TopicToolsRow({
  topicId,
  groupId,
  isManager,
  toolsCount,
}: {
  topicId: string;
  groupId: string;
  isManager: boolean;
  toolsCount: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [routinesCount, setRoutinesCount] = useState<number | null>(null);

  const counts = [
    ...(toolsCount === null ? [] : [String(toolsCount)]),
    ...(routinesCount === null ? [] : [String(routinesCount)]),
  ].join(' · ');

  return (
    <nav
      aria-label="This topic"
      className="overflow-hidden rounded-xl border border-border bg-surface-raised"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-[44px] w-full items-center gap-2.5 px-3 text-left hover:bg-list-hover"
      >
        <span className="key-icon inline-flex size-7 shrink-0 items-center justify-center rounded-lg">
          <Wrench className="size-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px]">Tools and routines</span>
        {counts !== '' && (
          <span className="font-mono text-[12px] text-muted-foreground">{counts}</span>
        )}
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-subtle-foreground transition-transform',
            open && 'rotate-90',
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-divider p-2">
          <ToolsSection scope={{ topicId }} scopeKey={`topic:${topicId}`} canManage={isManager} />
          <RoutinesSection
            scope={{ groupId }}
            scopeKey={`topic-routines:${topicId}`}
            canManage={isManager}
            onCount={setRoutinesCount}
          />
        </div>
      )}
    </nav>
  );
}

function visibilityLabel(visibility: 'public' | 'private'): string {
  return visibility === 'public' ? 'Public' : 'Private';
}

function TopicHeader({
  chat,
  visibility,
  groupTitle,
  suffix,
  onOpenGroup,
  onClose,
}: {
  chat: ChatSummary;
  visibility: 'public' | 'private';
  groupTitle: string;
  suffix: string;
  onOpenGroup?: () => void;
  onClose: () => void;
}) {
  const isPrivate = visibility === 'private';
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-divider p-4">
      <EntityAvatar chat={chat} size={44} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-semibold">
          {groupTitle !== '' && (
            <>
              {onOpenGroup !== undefined ? (
                <button
                  type="button"
                  onClick={onOpenGroup}
                  aria-label={`Open ${groupTitle} info`}
                  className="font-normal text-muted-foreground hover:underline"
                >
                  {groupTitle}
                </button>
              ) : (
                <span className="font-normal text-muted-foreground">{groupTitle}</span>
              )}
              <span className="font-normal text-muted-foreground"> › </span>
            </>
          )}
          {chat.title}
        </div>
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          {isPrivate && <Lock className="size-3" aria-hidden="true" />}
          {visibilityLabel(visibility)} topic
          {suffix}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        aria-label="Close topic panel"
        onClick={onClose}
        className="shrink-0 rounded-full text-muted-foreground"
      >
        <X className="size-5" aria-hidden="true" />
      </Button>
    </header>
  );
}

const MUTE_FAILED = 'Could not change the mute. Try again.';

function TopicMuteLeave({
  chat,
  groupTitle,
  leaving,
  onLeave,
}: {
  chat: ChatSummary;
  groupTitle: string;
  leaving: boolean;
  onLeave: () => void;
}) {
  const currentUserId = useChatSelector((s) => s.currentUserId);
  const [confirming, setConfirming] = useState(false);
  const { muted, busy, error, toggle } = useMuteToggle(chat);
  const topic = chat.topic;

  if (topic === undefined) {
    return null;
  }

  return (
    <section aria-label="Topic settings" className="flex flex-col gap-1">
      <ListRow
        icon={<Bell className="size-4" aria-hidden="true" />}
        title="Mute"
        trailing={
          <Switch
            checked={muted}
            onCheckedChange={() => toggle()}
            label={`Mute ${chat.title}`}
            hideLabel
            disabled={busy}
          />
        }
      />
      {topic.isGeneral !== true && isTopicJoined(topic, currentUserId) && (
        <ListRow
          danger
          icon={<LogOut className="size-4" aria-hidden="true" />}
          title={leaving ? 'Leaving…' : 'Leave topic'}
          {...(leaving ? {} : { onClick: () => setConfirming(true) })}
        />
      )}
      {error !== undefined && (
        <p role="alert" className="px-2 text-[12px] text-danger">
          {MUTE_FAILED}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title={`Leave ${chat.title}?`}
          body={
            topic.visibility === 'private'
              ? 'Someone in it has to add you back.'
              : `You stop getting its messages. You can join again from ${groupTitle}.`
          }
          confirmLabel="Leave topic"
          onConfirm={() => {
            setConfirming(false);
            onLeave();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
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
