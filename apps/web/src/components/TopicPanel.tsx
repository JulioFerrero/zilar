import type { ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { Brain, Lock, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Avatar } from './Avatar';
import { AiBadge } from './AiBadge';
import { ConfirmDialog } from './ConfirmDialog';
import { RoutinesSection } from './tools/RoutinesSection';
import { ToolsSection } from './tools/ToolsSection';
import { FieldError } from './ais/AiPageShell';
import { AiMemoryDialog } from './ais/AiMemoryDialog';
import { PinsSection } from './PinsPanel';
import { AlwaysAllowedList } from './approvals/AlwaysAllowedList';
import { Button } from './ui/button';
import { Sheet } from './ui/sheet';
import { StateMessage } from './ui/state-message';
import {
  ApiError,
  getTopic,
  listGroupRoles,
  listTopicAis,
  listTopicMembers,
  listTopicTools,
  type ApproverRole,
  type GroupDetail,
  type GroupRole,
  type PublicAi,
  type TopicAi,
  type TopicMember,
  type TopicRole,
  type TopicTool,
} from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { ApiFailure, isApiFailureCode, toApiFailure } from '@/lib/effect/errors';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';

type PanelStatus = 'loading' | 'ready' | 'error';
type GroupMemberRow = GroupDetail['members'][number];

function visibilityLabel(visibility: 'public' | 'private'): string {
  return visibility === 'public' ? 'Public' : 'Private';
}

/**
 * The sentence shown for a failed call: the API's own message, or the fixed
 * fallback for anything else (AGENTS.md: user-facing errors are fixed sentences).
 */
const textOf = (failure: ApiFailure, fallback: string): string =>
  failure.code === 'unknown_error' ? fallback : failure.message;

/**
 * A chat-store action. The store throws an ApiError (mapped as fromApi maps
 * it) or a plain Error whose message is the user-facing sentence, which keeps
 * its text. Any other cause becomes the unknown failure, so `textOf` shows the
 * fixed fallback.
 */
const storeCall = <A,>(call: () => Promise<A>): Effect.Effect<A, ApiFailure> =>
  Effect.tryPromise({
    try: call,
    catch: (cause) =>
      cause instanceof Error && !(cause instanceof ApiError)
        ? new ApiFailure({ status: 0, code: 'store_error', message: cause.message, detail: {} })
        : toApiFailure(cause),
  });

/** Shows a failure as the panel's inline error, with its fixed fallback. */
const failInline =
  (setError: (message: string) => void, fallback: string) => (failure: ApiFailure) =>
    Effect.sync(() => setError(textOf(failure, fallback)));

/**
 * The topic info panel (T-0111): visibility, members (private list with
 * Add/Remove for managers and Leave for a member; public shows "All N
 * members of the group"), AIs in the topic, the topic's Always-allowed
 * rules and tools count (read-only, rows show the topic name), Archive, and
 * Make public / Make private (private → public confirms with the
 * history-exposure warning).
 */
export function TopicPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const topic = chat.topic;
  if (topic === undefined) {
    return null;
  }
  return <TopicPanelBody chat={chat} topic={topic} onClose={onClose} />;
}

function TopicPanelBody({
  chat,
  topic,
  onClose,
}: {
  chat: ChatSummary;
  topic: NonNullable<ChatSummary['topic']>;
  onClose: () => void;
}) {
  const storeApi = useChatStoreApi();
  const store = useChatStore();
  const navigate = useNavigate();

  const topicId = topic.id;
  const groupTitle = chat.groupTitle ?? store.groupInfo(chat.id)?.title ?? '';
  const info: GroupDetail | undefined = store.groupInfo(chat.id);
  const me = store.currentUserId;
  const meRole = info?.members.find((member) => member.userId === me)?.role;
  const isManager = meRole === 'owner' || meRole === 'admin';

  const [membersState, setMembersState] = useState<{
    status: PanelStatus;
    members: TopicMember[];
    message: string;
  }>({ status: 'loading', members: [], message: '' });
  const [aisState, setAisState] = useState<{
    status: PanelStatus;
    ais: TopicAi[];
    message: string;
  }>({ status: 'loading', ais: [], message: '' });
  const [toolsCount, setToolsCount] = useState<number | null>(null);
  const [myAis, setMyAis] = useState<PublicAi[]>([]);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [aiPickerOpen, setAiPickerOpen] = useState(false);
  const [confirmingVisibility, setConfirmingVisibility] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [memoryAi, setMemoryAi] = useState<{ id: string; name: string } | undefined>(undefined);

  useEffect(() => {
    storeApi.getState().refreshGroupInfo(chat.id);
  }, [storeApi, chat.id]);

  // Members and AIs load when the panel opens; the topic detail (strip)
  // already rides the chat row. A failure shows an inline error with Retry.
  // A list that is already shown stays on screen while it reloads, so the
  // rows of a call still running are not unmounted under it.
  const setMembersFailure = (failure: ApiFailure): void =>
    setMembersState({
      status: 'error',
      members: [],
      message: textOf(failure, 'Could not load the members.'),
    });
  // `onShown` runs in the same step as the list update, so a row or picker
  // that the update removes has finished its last step.
  const fetchMembers = (onShown: () => void = () => undefined): Effect.Effect<void, ApiFailure> =>
    fromApi(() => listTopicMembers(topicId)).pipe(
      Effect.tap((members) =>
        Effect.sync(() => {
          setMembersState({ status: 'ready', members, message: '' });
          onShown();
        }),
      ),
      Effect.asVoid,
    );
  const loadMembers = Effect.sync(() =>
    setMembersState((previous) =>
      previous.status === 'ready' ? previous : { status: 'loading', members: [], message: '' },
    ),
  ).pipe(
    Effect.andThen(fetchMembers()),
    Effect.catchTag('ApiFailure', (failure) => Effect.sync(() => setMembersFailure(failure))),
  );
  const [, refreshMembers] = useQuery(() => loadMembers, [topicId]);
  // The list re-read after an action: a failure shows the list's inline error,
  // and `done` runs in the same step either way.
  const reloadMembersAfter = (done: () => void = () => undefined): Effect.Effect<void> =>
    fetchMembers(done).pipe(
      Effect.catchTag('ApiFailure', (failure) =>
        Effect.sync(() => {
          setMembersFailure(failure);
          done();
        }),
      ),
    );

  const setAisFailure = (failure: ApiFailure): void =>
    setAisState({ status: 'error', ais: [], message: textOf(failure, 'Could not load the AIs.') });
  const fetchAis = (onShown: () => void = () => undefined): Effect.Effect<void, ApiFailure> =>
    fromApi(() => listTopicAis(topicId)).pipe(
      Effect.tap((ais) =>
        Effect.sync(() => {
          setAisState({ status: 'ready', ais, message: '' });
          onShown();
        }),
      ),
      Effect.asVoid,
    );
  const loadAis = Effect.sync(() =>
    setAisState((previous) =>
      previous.status === 'ready' ? previous : { status: 'loading', ais: [], message: '' },
    ),
  ).pipe(
    Effect.andThen(fetchAis()),
    Effect.catchTag('ApiFailure', (failure) => Effect.sync(() => setAisFailure(failure))),
  );
  const [, refreshAis] = useQuery(() => loadAis, [topicId]);
  const reloadAisAfter = (done: () => void = () => undefined): Effect.Effect<void> =>
    fetchAis(done).pipe(
      Effect.catchTag('ApiFailure', (failure) =>
        Effect.sync(() => {
          setAisFailure(failure);
          done();
        }),
      ),
    );

  useQuery(
    () =>
      fromApi(() => listTopicTools(topicId)).pipe(
        Effect.tap((tools: TopicTool[]) => Effect.sync(() => setToolsCount(tools.length))),
        Effect.catchTag('ApiFailure', () => Effect.sync(() => setToolsCount(null))),
      ),
    [topicId],
  );

  useQuery(
    () =>
      storeCall(() => storeApi.getState().listMyAis()).pipe(
        Effect.tap((list) =>
          Effect.sync(() => setMyAis(list.filter((ai) => ai.status === 'active'))),
        ),
        Effect.catchTag('ApiFailure', () => Effect.sync(() => setMyAis([]))),
      ),
    [storeApi],
  );

  const clearError = Effect.sync(() => setErrorMessage(''));

  // The row re-check after a removal 404. A superseded refresh (the store
  // restarted mid-flight) rejects with `stale_refresh` instead of merging:
  // retry once so a transient restart does not surface the store's
  // "superseded" wording in the panel; a second supersede is genuinely
  // stale state, so report a generic message the user can act on.
  const refreshTopicRowOnce = (): Effect.Effect<boolean, ApiFailure> => {
    const recheck = storeCall(() => storeApi.getState().refreshTopicRow(chat.id, topic.id));
    return recheck.pipe(
      Effect.catchIf(isApiFailureCode('stale_refresh'), () =>
        recheck.pipe(
          Effect.catchIf(isApiFailureCode('stale_refresh'), () =>
            Effect.fail(
              new ApiFailure({
                status: 0,
                code: 'stale_refresh',
                message: 'Could not refresh the topic. Try again.',
                detail: {},
              }),
            ),
          ),
        ),
      ),
    );
  };

  const closeTopicScreen = Effect.sync(() => {
    navigate('/');
    onClose();
  });

  /** A failed reload after a delete drops the member's row locally (never a stale row). */
  const dropMemberRow = (userId: string): void => {
    setMembersState((previous) => ({
      status: previous.status === 'ready' && previous.members.length > 1 ? 'ready' : 'error',
      members: previous.members.filter((member) => member.userId !== userId),
      message: 'Could not refresh the list.',
    }));
  };

  // A 404 alone never means "the topic is gone" — the server also 404s for a
  // user who is not a member — so only navigate away when the refreshed list
  // no longer has the topic row. Any other failure keeps the user here with
  // the inline error.
  const afterMissingMember = (): Effect.Effect<void, ApiFailure> =>
    refreshTopicRowOnce().pipe(
      Effect.flatMap((gone) => (gone ? closeTopicScreen : reloadMembersAfter())),
    );

  // ONE call: the store issues the POST and folds the row back in. The
  // picker closes in the same step as the list update.
  const addMember = (userId: string): Effect.Effect<void, ApiFailure> =>
    storeCall(() => storeApi.getState().addTopicMember(chat.id, userId)).pipe(
      Effect.andThen(reloadMembersAfter(() => setMemberPickerOpen(false))),
    );

  // ONE call: the store issues the DELETE and folds the row back in (real)
  // or drops it when archived (both). A 404 alone never means "the topic is
  // gone" (see afterMissingMember).
  const removeMember = (userId: string): Effect.Effect<void, ApiFailure> =>
    storeCall(() => storeApi.getState().removeTopicMember(chat.id, userId)).pipe(
      Effect.matchEffect({
        onFailure: (failure: ApiFailure): Effect.Effect<void, ApiFailure> =>
          failure.status === 404 ? afterMissingMember() : Effect.fail(failure),
        onSuccess: (): Effect.Effect<void> =>
          fetchMembers().pipe(
            Effect.catchTag('ApiFailure', () => Effect.sync(() => dropMemberRow(userId))),
          ),
      }),
    );

  // ONE call: the store issues the POST and folds the row back in.
  const addAi = (aiId: string): Effect.Effect<void, ApiFailure> =>
    storeCall(() => storeApi.getState().addTopicAi(chat.id, aiId)).pipe(
      Effect.andThen(reloadAisAfter(() => setAiPickerOpen(false))),
    );

  // ONE call: the store issues the DELETE and folds the row back in.
  // The reload may fail after a successful delete (transient network):
  // never show the removed row as if the delete failed — drop it
  // locally and surface the refresh problem with its own Retry instead.
  const removeAi = (aiId: string): Effect.Effect<void, ApiFailure> =>
    storeCall(() => storeApi.getState().removeTopicAi(chat.id, aiId)).pipe(
      Effect.andThen(
        fetchAis().pipe(
          Effect.catchTag('ApiFailure', () =>
            Effect.sync(() =>
              setAisState((previous) => ({
                status: previous.status === 'ready' && previous.ais.length > 0 ? 'ready' : 'error',
                ais: previous.ais.filter((ai) => ai.id !== aiId),
                message: 'Could not refresh the list.',
              })),
            ),
          ),
        ),
      ),
    );

  const leaveEffect = storeCall(() => storeApi.getState().leaveTopic(chat.id)).pipe(
    // The store's `leaveTopic` swallows the last-seat 404 itself (the topic
    // archived, so there is nothing left to leave): success means the caller
    // is out either way, so navigate away.
    Effect.andThen(closeTopicScreen),
  );

  const archiveEffect = storeCall(() =>
    storeApi.getState().patchTopic(chat.id, { archived: true }),
  ).pipe(
    Effect.matchEffect({
      onFailure: (): Effect.Effect<void> =>
        Effect.sync(() => {
          setErrorMessage('Could not archive the topic.');
          setConfirmingArchive(false);
        }),
      onSuccess: (): Effect.Effect<void> =>
        Effect.sync(() => setConfirmingArchive(false)).pipe(Effect.andThen(closeTopicScreen)),
    }),
  );

  const flipVisibilityEffect = (): Effect.Effect<void, ApiFailure> => {
    const toPublic = topic.visibility === 'private';
    return storeCall(() =>
      storeApi.getState().patchTopic(chat.id, {
        visibility: toPublic ? 'public' : 'private',
        ...(toPublic ? { confirmExposeHistory: true } : { memberIds: [me] }),
      }),
    ).pipe(
      Effect.matchEffect({
        onFailure: (): Effect.Effect<void> =>
          Effect.sync(() => {
            setErrorMessage(
              toPublic ? 'Could not make the topic public.' : 'Could not make the topic private.',
            );
            setConfirmingVisibility(false);
          }),
        onSuccess: (): Effect.Effect<void> =>
          Effect.sync(() => setConfirmingVisibility(false)).pipe(
            Effect.andThen(reloadMembersAfter()),
          ),
      }),
    );
  };

  // The panel-level buttons each own their call; the confirm dialogs stay here.
  const [leaveState, runLeave] = useAction<void, void, never>(() =>
    clearError.pipe(
      Effect.andThen(leaveEffect),
      Effect.catchTag('ApiFailure', failInline(setErrorMessage, 'Could not leave the topic.')),
    ),
  );
  const [archiveState, runArchive] = useAction<void, void, never>(() =>
    clearError.pipe(Effect.andThen(archiveEffect)),
  );
  const [visibilityState, runVisibility] = useAction<void, void, never>(() =>
    clearError.pipe(
      Effect.andThen(flipVisibilityEffect()),
      Effect.catchTag(
        'ApiFailure',
        failInline(setErrorMessage, 'Could not change the visibility.'),
      ),
    ),
  );

  const isPrivate = topic.visibility === 'private';
  const groupMembers = info?.members ?? [];
  const addableMembers = groupMembers.filter(
    (member) =>
      member.userId !== me && !membersState.members.some((item) => item.userId === member.userId),
  );
  const groupAis = info?.ais ?? [];
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
  const iAmMember = membersState.members.some((member) => member.userId === me);
  const visibilityBusy = isWaiting(visibilityState);

  return (
    <>
      <Sheet open onClose={onClose} ariaLabel={`${chat.title} topic info`}>
        <header className="flex shrink-0 items-center gap-3 border-b border-divider p-4">
          <Avatar id={chat.id} name={chat.title} size={44} avatarUrl={chat.avatarUrl} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-semibold">
              {groupTitle !== '' && (
                <span className="font-normal text-muted-foreground">{groupTitle} › </span>
              )}
              {chat.title}
            </div>
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              {isPrivate && <Lock className="size-3" aria-hidden="true" />}
              {visibilityLabel(topic.visibility)} topic
              {isPrivate && membersState.status === 'ready'
                ? ` · ${membersState.members.length} members`
                : ''}
              {!isPrivate && info !== undefined ? ` · All ${info.members.length} members` : ''}
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

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <section aria-label="Members" className="flex flex-col gap-1">
            <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Members</h2>
            {isPrivate ? (
              <>
                {membersState.status === 'loading' && (
                  <StateMessage kind="loading" size="inline" title="Loading…" />
                )}
                {membersState.status === 'error' && (
                  <div className="flex flex-col gap-2 px-2">
                    <FieldError>{membersState.message}</FieldError>
                    <Button
                      type="button"
                      size="lg"
                      className="self-start rounded-full px-4"
                      onClick={() => refreshMembers()}
                    >
                      Retry
                    </Button>
                  </div>
                )}
                {membersState.status === 'ready' && membersState.message !== '' && (
                  <div className="flex items-center gap-2 px-2">
                    <p className="flex-1 text-[12px] text-muted-foreground">
                      {membersState.message}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => refreshMembers()}
                    >
                      Retry
                    </Button>
                  </div>
                )}
                {membersState.status === 'ready' &&
                  membersState.members.map((member) => {
                    const detail = groupMembers.find((item) => item.userId === member.userId);
                    return (
                      <div
                        key={member.userId}
                        className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
                      >
                        <Avatar
                          id={member.userId}
                          name={member.name}
                          size={32}
                          avatarUrl={detail?.avatarUrl}
                        />
                        <span className="min-w-0 flex-1 truncate text-[14px]">
                          {member.name}
                          {member.userId === me && (
                            <span className="text-muted-foreground"> (you)</span>
                          )}
                        </span>
                        {detail?.role !== undefined && detail.role !== 'member' && (
                          <span className="font-mono rounded-[5px] border border-badge-muted px-1 text-[10px] leading-[15px] text-muted-foreground">
                            {detail.role}
                          </span>
                        )}
                        {isManager && member.userId !== me && (
                          <RemoveMemberButton
                            member={member}
                            remove={removeMember}
                            onError={setErrorMessage}
                          />
                        )}
                      </div>
                    );
                  })}
                {isManager && addableMembers.length > 0 && (
                  <div className="mt-1 flex flex-col gap-1 px-2">
                    {memberPickerOpen ? (
                      <>
                        {addableMembers.map((member) => (
                          <AddMemberButton
                            key={member.userId}
                            member={member}
                            add={addMember}
                            onError={setErrorMessage}
                          />
                        ))}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="self-start"
                          onClick={() => setMemberPickerOpen(false)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="lg"
                        className="self-start rounded-full px-4"
                        onClick={() => setMemberPickerOpen(true)}
                      >
                        Add people
                      </Button>
                    )}
                  </div>
                )}
                {!isManager && iAmMember && (
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="mx-2 self-start rounded-full px-4"
                    disabled={isWaiting(leaveState)}
                    onClick={() => runLeave()}
                  >
                    {isWaiting(leaveState) ? 'Leaving…' : 'Leave topic'}
                  </Button>
                )}
              </>
            ) : (
              <p className="px-2 text-[13px] text-muted-foreground">
                All {info?.members.length ?? chat.memberCount ?? 0} members of {groupTitle} can read
                and write here.
              </p>
            )}
          </section>

          <section aria-label="AIs in this topic" className="flex flex-col gap-1">
            <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">
              AIs in this topic
            </h2>
            {aisState.status === 'loading' && (
              <StateMessage kind="loading" size="inline" title="Loading…" />
            )}
            {aisState.status === 'error' && (
              <div className="flex flex-col gap-2 px-2">
                <FieldError>{aisState.message}</FieldError>
                <Button
                  type="button"
                  size="lg"
                  className="self-start rounded-full px-4"
                  onClick={() => refreshAis()}
                >
                  Retry
                </Button>
              </div>
            )}
            {aisState.status === 'ready' &&
              aisState.ais.length === 0 &&
              aisState.message === '' && (
                <p className="px-2 text-[13px] text-muted-foreground">No AIs in this topic yet.</p>
              )}
            {aisState.status === 'ready' && aisState.message !== '' && (
              <div className="flex items-center gap-2 px-2">
                <p className="flex-1 text-[12px] text-muted-foreground">{aisState.message}</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => refreshAis()}>
                  Retry
                </Button>
              </div>
            )}
            {aisState.status === 'ready' &&
              aisState.ais.map((ai) => {
                // Topic AI rows carry no picture; the group detail knows it.
                const picture = groupAis.find((item) => item.aiId === ai.id)?.avatarUrl;
                return (
                  <div
                    key={ai.id}
                    className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
                  >
                    <Avatar id={ai.id} name={ai.name} size={32} ai avatarUrl={picture} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[14px]">{ai.name}</span>
                        <AiBadge />
                      </div>
                      <p className="truncate text-[12px] text-muted-foreground">
                        Added by {aiOwnerName(ai.id)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`What ${ai.name} remembers`}
                      className="shrink-0 text-muted-foreground"
                      onClick={() => setMemoryAi({ id: ai.id, name: ai.name })}
                    >
                      <Brain className="size-4" aria-hidden="true" />
                    </Button>
                    {canRemoveAi(ai.id) && (
                      <RemoveAiButton ai={ai} remove={removeAi} onError={setErrorMessage} />
                    )}
                  </div>
                );
              })}
            {addableAis.length > 0 && (
              <div className="mt-1 flex flex-col gap-1 px-2">
                {aiPickerOpen ? (
                  <>
                    {addableAis.map((ai) => (
                      <AddAiButton key={ai.id} ai={ai} add={addAi} onError={setErrorMessage} />
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start"
                      onClick={() => setAiPickerOpen(false)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="lg"
                    className="self-start rounded-full px-4"
                    onClick={() => setAiPickerOpen(true)}
                  >
                    Add my AI
                  </Button>
                )}
              </div>
            )}
          </section>

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
            <section aria-label="Danger zone" className="flex flex-col gap-2 px-2">
              {isManager && (
                <>
                  {topic.visibility === 'private' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="self-start rounded-full px-4"
                      disabled={visibilityBusy}
                      onClick={() => setConfirmingVisibility(true)}
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
                      onClick={() => runVisibility()}
                    >
                      {visibilityBusy ? 'Saving…' : 'Make private'}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="destructive"
                    size="lg"
                    className="self-start rounded-full px-4"
                    disabled={isWaiting(archiveState)}
                    onClick={() => setConfirmingArchive(true)}
                  >
                    Archive topic
                  </Button>
                </>
              )}
            </section>
          )}

          {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}
        </div>
      </Sheet>

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
    </>
  );
}

/**
 * Removes one member. The row owns its call, so two rows can run at once, and
 * a second click on the same row is ignored while it waits.
 */
function RemoveMemberButton({
  member,
  remove,
  onError,
}: {
  member: TopicMember;
  remove: (userId: string) => Effect.Effect<void, ApiFailure>;
  onError: (message: string) => void;
}) {
  const [state, run] = useAction<string, void, never>((userId) =>
    remove(userId).pipe(
      Effect.catchTag('ApiFailure', failInline(onError, 'Could not remove the member.')),
    ),
  );
  const removing = isWaiting(state);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`Remove ${member.name} from the topic`}
      className="shrink-0"
      disabled={removing}
      onClick={() => {
        onError('');
        run(member.userId);
      }}
    >
      {removing ? 'Removing…' : 'Remove'}
    </Button>
  );
}

/** Adds one group member from the picker; one call per row, as RemoveMemberButton. */
function AddMemberButton({
  member,
  add,
  onError,
}: {
  member: GroupMemberRow;
  add: (userId: string) => Effect.Effect<void, ApiFailure>;
  onError: (message: string) => void;
}) {
  const [state, run] = useAction<string, void, never>((userId) =>
    add(userId).pipe(
      Effect.catchTag('ApiFailure', failInline(onError, 'Could not add the member.')),
    ),
  );
  const adding = isWaiting(state);
  return (
    <Button
      type="button"
      variant="outline"
      disabled={adding}
      onClick={() => {
        onError('');
        run(member.userId);
      }}
      className="h-auto justify-start gap-2 rounded-xl px-2 py-1.5 text-left text-[14px] font-normal"
    >
      <Avatar id={member.userId} name={member.name} size={28} avatarUrl={member.avatarUrl} />
      <span className="min-w-0 flex-1 truncate">{member.name}</span>
      {adding && <span className="text-[12px] text-muted-foreground">Adding…</span>}
    </Button>
  );
}

/** Removes one AI from the topic, with its own call. */
function RemoveAiButton({
  ai,
  remove,
  onError,
}: {
  ai: TopicAi;
  remove: (aiId: string) => Effect.Effect<void, ApiFailure>;
  onError: (message: string) => void;
}) {
  const [state, run] = useAction<string, void, never>((aiId) =>
    remove(aiId).pipe(
      Effect.catchTag('ApiFailure', failInline(onError, 'Could not remove the AI.')),
    ),
  );
  const removing = isWaiting(state);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`Remove ${ai.name} from the topic`}
      className="shrink-0"
      disabled={removing}
      onClick={() => {
        onError('');
        run(ai.id);
      }}
    >
      {removing ? 'Removing…' : 'Remove'}
    </Button>
  );
}

/** Adds one of my AIs from the picker, with its own call. */
function AddAiButton({
  ai,
  add,
  onError,
}: {
  ai: PublicAi;
  add: (aiId: string) => Effect.Effect<void, ApiFailure>;
  onError: (message: string) => void;
}) {
  const [state, run] = useAction<string, void, never>((aiId) =>
    add(aiId).pipe(Effect.catchTag('ApiFailure', failInline(onError, 'Could not add the AI.'))),
  );
  const adding = isWaiting(state);
  return (
    <Button
      type="button"
      variant="outline"
      disabled={adding}
      onClick={() => {
        onError('');
        run(ai.id);
      }}
      className="h-auto justify-start gap-2 rounded-xl px-2 py-1.5 text-left text-[14px] font-normal"
    >
      <Avatar id={ai.jid} name={ai.name} size={28} ai avatarUrl={ai.avatarUrl} />
      <span className="min-w-0 flex-1 truncate">{ai.name}</span>
      <AiBadge />
      {adding && <span className="text-[12px] text-muted-foreground">Adding…</span>}
    </Button>
  );
}

/** The topic's Always-allowed rules, read-only: rows show the topic name. */
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

/**
 * The topic's roles (T-0116): attached roles with holder counts next to the
 * people list, and the approver select ("Owner and admins only" or one
 * role). Managers edit; everyone else reads. Saving goes through the
 * store so the chat row refreshes. Saves stay one action for the section:
 * each save sends the whole role list, so two saves at once would drop one.
 */
function TopicRolesSection({
  chatId,
  topicId,
  groupId,
  isManager,
}: {
  chatId: string;
  topicId: string;
  groupId: string;
  isManager: boolean;
}) {
  const storeApi = useChatStoreApi();
  const [rolesState, setRolesState] = useState<{
    status: PanelStatus;
    roles: TopicRole[];
    approverRole: ApproverRole | null;
    message: string;
  }>({ status: 'loading', roles: [], approverRole: null, message: '' });
  const [groupRoles, setGroupRoles] = useState<GroupRole[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // The topic and the group's roles load side by side; a failure shows the
  // inline error with Retry.
  const loadRoles = Effect.sync(() =>
    setRolesState({ status: 'loading', roles: [], approverRole: null, message: '' }),
  ).pipe(
    Effect.andThen(
      Effect.all([fromApi(() => getTopic(topicId)), fromApi(() => listGroupRoles(groupId))], {
        concurrency: 'unbounded',
      }),
    ),
    Effect.tap(([topic, roles]) =>
      Effect.sync(() => {
        setGroupRoles(roles);
        setRolesState({
          status: 'ready',
          roles: topic.roles ?? [],
          approverRole: topic.approverRole ?? null,
          message: '',
        });
      }),
    ),
    Effect.catchTag('ApiFailure', (failure) =>
      Effect.sync(() =>
        setRolesState({
          status: 'error',
          roles: [],
          approverRole: null,
          message: textOf(failure, 'Could not load the roles.'),
        }),
      ),
    ),
  );
  const [, refreshRoles] = useQuery(() => loadRoles, [topicId, groupId]);

  // A second click while a save waits is dropped (mode 'ignore').
  const [saveState, saveRoles] = useAction(
    (input: { roleIds: string[]; approverRoleId: string | null }) =>
      Effect.sync(() => setErrorMessage('')).pipe(
        Effect.andThen(storeCall(() => storeApi.getState().setTopicRoles(chatId, input))),
        Effect.andThen(loadRoles),
        Effect.andThen(Effect.sync(() => setPickerOpen(false))),
        Effect.catchTag('ApiFailure', failInline(setErrorMessage, 'Could not save the roles.')),
      ),
  );
  const busy = isWaiting(saveState);

  const save = (roleIds: string[], approverRoleId: string | null): void =>
    saveRoles({ roleIds, approverRoleId });

  const toggleRole = (roleId: string): void => {
    if (rolesState.status !== 'ready') {
      return;
    }
    const attached = rolesState.roles.some((role) => role.id === roleId);
    const roleIds = attached
      ? rolesState.roles.filter((role) => role.id !== roleId).map((role) => role.id)
      : [...rolesState.roles.map((role) => role.id), roleId];
    save(roleIds, rolesState.approverRole?.id ?? null);
  };

  const pickApprover = (value: string): void => {
    if (rolesState.status !== 'ready') {
      return;
    }
    save(
      rolesState.roles.map((role) => role.id),
      value === '' ? null : value,
    );
  };

  return (
    <section aria-label="Roles" className="flex flex-col gap-1">
      <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Roles</h2>
      {rolesState.status === 'loading' && (
        <StateMessage kind="loading" size="inline" title="Loading…" />
      )}
      {rolesState.status === 'error' && (
        <div className="flex flex-col gap-2 px-2">
          <FieldError>{rolesState.message}</FieldError>
          <Button
            type="button"
            size="lg"
            className="self-start rounded-full px-4"
            onClick={() => refreshRoles()}
          >
            Retry
          </Button>
        </div>
      )}
      {rolesState.status === 'ready' && (
        <>
          {rolesState.roles.length === 0 ? (
            <p className="px-2 text-[13px] text-muted-foreground">
              No roles here yet — only the people above can see this topic.
            </p>
          ) : (
            rolesState.roles.map((role) => (
              <div
                key={role.id}
                className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
              >
                <span className="min-w-0 flex-1 truncate text-[14px]">
                  {role.name} ({role.memberCount})
                </span>
                {isManager && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Remove ${role.name} from the topic`}
                    className="shrink-0"
                    disabled={busy}
                    onClick={() => void toggleRole(role.id)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))
          )}
          {isManager && (
            <>
              {pickerOpen ? (
                <div className="mt-1 flex flex-col gap-1 px-2">
                  {groupRoles
                    .filter((role) => !rolesState.roles.some((item) => item.id === role.id))
                    .map((role) => (
                      <Button
                        key={role.id}
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void toggleRole(role.id)}
                        className="h-auto justify-start gap-2 rounded-xl px-2 py-1.5 text-left text-[14px] font-normal"
                      >
                        <span className="min-w-0 flex-1 truncate">{role.name}</span>
                        <span className="text-[12px] text-muted-foreground">
                          {role.members.length}
                        </span>
                      </Button>
                    ))}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    onClick={() => setPickerOpen(false)}
                  >
                    Done
                  </Button>
                </div>
              ) : (
                groupRoles.some(
                  (role) => !rolesState.roles.some((item) => item.id === role.id),
                ) && (
                  <Button
                    type="button"
                    size="lg"
                    className="mx-2 self-start rounded-full px-4"
                    onClick={() => setPickerOpen(true)}
                  >
                    Add roles
                  </Button>
                )
              )}
              <label className="mt-1 flex flex-col gap-1 px-2">
                <span className="text-[13px] font-medium text-muted-foreground">Approvers</span>
                <select
                  aria-label="Approvers"
                  value={rolesState.approverRole?.id ?? ''}
                  disabled={busy}
                  onChange={(event) => pickApprover(event.target.value)}
                  className="well-surface rounded-[10px] px-3 py-2 text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <option value="">Owner and admins only</option>
                  {rolesState.roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {!isManager && rolesState.approverRole !== null && (
            <p className="px-2 text-[13px] text-muted-foreground">
              Approvers: {rolesState.approverRole.name}
            </p>
          )}
          {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}
        </>
      )}
    </section>
  );
}
