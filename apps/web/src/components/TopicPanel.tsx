import type { ChatSummary } from '@zilar/chat-core';
import { Lock, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Avatar } from './Avatar';
import { AiBadge } from './AiBadge';
import { ConfirmDialog } from './ConfirmDialog';
import { RoutinesSection } from './tools/RoutinesSection';
import { ToolsSection } from './tools/ToolsSection';
import { FieldError } from './ais/AiPageShell';
import { PinsSection } from './PinsPanel';
import { AlwaysAllowedList } from './approvals/AlwaysAllowedList';
import { Button } from './ui/button';
import { Sheet } from './ui/sheet';
import { StateMessage } from './ui/state-message';
import { cn } from '@/lib/utils';
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
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';

type PanelStatus = 'loading' | 'ready' | 'error';

function visibilityLabel(visibility: 'public' | 'private'): string {
  return visibility === 'public' ? 'Public' : 'Private';
}

/**
 * The topic info panel (T-0111): visibility, members (private list with
 * Add/Remove for managers and Leave for a member; public shows "All N
 * members of the group"), AIs in the topic, the topic's Always-allowed
 * rules and tools count (read-only, rows show the topic name), Archive, and
 * Make public / Make private (private → public confirms with the
 * history-exposure warning).
 */
export function TopicPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const storeApi = useChatStoreApi();
  const store = useChatStore();
  const navigate = useNavigate();

  const topic = chat.topic;
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
  const [busyId, setBusyId] = useState<string | undefined>(undefined);
  const [confirmingVisibility, setConfirmingVisibility] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    storeApi.getState().refreshGroupInfo(chat.id);
  }, [storeApi, chat.id]);

  // Members and AIs load once when the panel opens; the topic detail (strip)
  // already rides the chat row. A failure shows an inline error with Retry.
  const topicId = topic?.id;
  useEffect(() => {
    let active = true;
    if (topicId === undefined) {
      return;
    }
    listTopicMembers(topicId)
      .then((members) => {
        if (active) {
          setMembersState({ status: 'ready', members, message: '' });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setMembersState({
            status: 'error',
            members: [],
            message: error instanceof Error ? error.message : 'Could not load the members.',
          });
        }
      });
    listTopicAis(topicId)
      .then((ais) => {
        if (active) {
          setAisState({ status: 'ready', ais, message: '' });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setAisState({
            status: 'error',
            ais: [],
            message: error instanceof Error ? error.message : 'Could not load the AIs.',
          });
        }
      });
    listTopicTools(topicId)
      .then((tools: TopicTool[]) => {
        if (active) {
          setToolsCount(tools.length);
        }
      })
      .catch(() => {
        if (active) {
          setToolsCount(null);
        }
      });
    return () => {
      active = false;
    };
  }, [topicId]);

  useEffect(() => {
    let active = true;
    storeApi
      .getState()
      .listMyAis()
      .then((list) => {
        if (active) {
          setMyAis(list.filter((ai) => ai.status === 'active'));
        }
      })
      .catch(() => {
        if (active) {
          setMyAis([]);
        }
      });
    return () => {
      active = false;
    };
  }, [storeApi]);

  if (topic === undefined) {
    return null;
  }

  // The reload after a remove re-lists from the server. It throws (the
  // panel catches) so a delete-followed-by-failed-reload can drop the row
  // locally with its own "Could not refresh the list." line instead of
  // either showing an error state that looks like the delete failed or
  // swallowing the failure. The panel Retry buttons catch the same shape.
  const reloadMembers = async (): Promise<void> => {
    setMembersState({ status: 'loading', members: [], message: '' });
    try {
      setMembersState({ status: 'ready', members: await listTopicMembers(topic.id), message: '' });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Could not load the members.');
    }
  };

  const reloadAis = async (): Promise<void> => {
    setAisState({ status: 'loading', ais: [], message: '' });
    try {
      setAisState({ status: 'ready', ais: await listTopicAis(topic.id), message: '' });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Could not load the AIs.');
    }
  };

  const run = async (label: string, work: () => Promise<void>): Promise<void> => {
    setBusyId(label);
    setErrorMessage('');
    try {
      await work();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : `Could not ${label}.`);
    } finally {
      setBusyId(undefined);
    }
  };

  const addMember = (userId: string): Promise<void> =>
    run(`add:${userId}`, async () => {
      // ONE call: the store issues the POST and folds the row back in.
      await storeApi.getState().addTopicMember(chat.id, userId);
      await reloadMembers().catch((error: unknown) => {
        setMembersState({
          status: 'error',
          members: [],
          message: error instanceof Error ? error.message : 'Could not load the members.',
        });
      });
      setMemberPickerOpen(false);
    });

  const removeMember = (userId: string): Promise<void> =>
    run(`remove:${userId}`, async () => {
      // ONE call: the store issues the DELETE and folds the row back in
      // (real) or drops it when archived (both). A 404 alone never means
      // "the topic is gone" — the server also 404s for a user who is not a
      // member — so only navigate away when the refreshed list no longer
      // has the topic row. Any other failure keeps the user here with the
      // inline error. A failed reload after a successful delete drops the
      // row locally with its own refresh message (never a stale row).
      try {
        await storeApi.getState().removeTopicMember(chat.id, userId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          const gone = await refreshTopicRowOnce();
          if (gone) {
            navigate('/');
            onClose();
            return;
          }
          await reloadMembers().catch((reloadError: unknown) => {
            setMembersState({
              status: 'error',
              members: [],
              message:
                reloadError instanceof Error ? reloadError.message : 'Could not load the members.',
            });
          });
          return;
        }
        throw error;
      }
      try {
        await reloadMembers();
      } catch {
        removeMemberRowFallback(userId);
      }
    });

  // The row re-check after a removal 404. A superseded refresh (the store
  // restarted mid-flight) rejects with `stale_refresh` instead of merging:
  // retry once so a transient restart does not surface the store's
  // "superseded" wording in the panel; a second supersede is genuinely
  // stale state, so report a generic message the user can act on.
  const refreshTopicRowOnce = async (): Promise<boolean> => {
    try {
      return await storeApi.getState().refreshTopicRow(chat.id, topic.id);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'stale_refresh') {
        try {
          return await storeApi.getState().refreshTopicRow(chat.id, topic.id);
        } catch (retryError) {
          if (retryError instanceof ApiError && retryError.code === 'stale_refresh') {
            throw new Error('Could not refresh the topic. Try again.');
          }
          throw retryError;
        }
      }
      throw error;
    }
  };

  const leave = (): Promise<void> =>
    run('leave', async () => {
      // The store's `leaveTopic` swallows the last-seat 404 itself (the
      // topic archived, so there is nothing left to leave): success means
      // the caller is out either way, so navigate away. A 404 that means
      // "not a member" rethrows (the row re-check found the topic alive),
      // like any other failure (network, 403) — stay with the inline error.
      await storeApi.getState().leaveTopic(chat.id);
      navigate('/');
      onClose();
    });

  const addAi = (aiId: string): Promise<void> =>
    run(`addAi:${aiId}`, async () => {
      // ONE call: the store issues the POST and folds the row back in.
      await storeApi.getState().addTopicAi(chat.id, aiId);
      await reloadAis().catch((error: unknown) => {
        setAisState({
          status: 'error',
          ais: [],
          message: error instanceof Error ? error.message : 'Could not load the AIs.',
        });
      });
      setAiPickerOpen(false);
    });

  const removeAi = (aiId: string): Promise<void> =>
    run(`removeAi:${aiId}`, async () => {
      // ONE call: the store issues the DELETE and folds the row back in.
      // The reload may fail after a successful delete (transient network):
      // never show the removed row as if the delete failed — drop it
      // locally and surface the refresh problem with its own Retry instead.
      await storeApi.getState().removeTopicAi(chat.id, aiId);
      await reloadAis().catch(() => {
        setAisState((previous) => ({
          status: previous.status === 'ready' && previous.ais.length > 0 ? 'ready' : 'error',
          ais: previous.ais.filter((ai) => ai.id !== aiId),
          message: 'Could not refresh the list.',
        }));
      });
    });

  /** Same as `removeAi`: a failed reload after a delete drops the row locally. */
  const removeMemberRowFallback = (userId: string): void => {
    setMembersState((previous) => ({
      status: previous.status === 'ready' && previous.members.length > 1 ? 'ready' : 'error',
      members: previous.members.filter((member) => member.userId !== userId),
      message: 'Could not refresh the list.',
    }));
  };

  const archive = (): Promise<void> =>
    run('archive', async () => {
      try {
        await storeApi.getState().patchTopic(chat.id, { archived: true });
      } catch {
        setErrorMessage('Could not archive the topic.');
        setConfirmingArchive(false);
        return;
      }
      setConfirmingArchive(false);
      navigate('/');
      onClose();
    });

  const flipVisibility = (): Promise<void> =>
    run('visibility', async () => {
      const toPublic = topic.visibility === 'private';
      try {
        await storeApi.getState().patchTopic(chat.id, {
          visibility: toPublic ? 'public' : 'private',
          ...(toPublic ? { confirmExposeHistory: true } : { memberIds: [me] }),
        });
      } catch {
        setErrorMessage(
          toPublic ? 'Could not make the topic public.' : 'Could not make the topic private.',
        );
        setConfirmingVisibility(false);
        return;
      }
      setConfirmingVisibility(false);
      await reloadMembers().catch((error: unknown) => {
        setMembersState({
          status: 'error',
          members: [],
          message: error instanceof Error ? error.message : 'Could not load the members.',
        });
      });
    });

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
                      onClick={() =>
                        void reloadMembers().catch((error: unknown) => {
                          setMembersState({
                            status: 'error',
                            members: [],
                            message:
                              error instanceof Error
                                ? error.message
                                : 'Could not load the members.',
                          });
                        })
                      }
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
                      onClick={() =>
                        void reloadMembers().catch((error: unknown) => {
                          setMembersState({
                            status: 'error',
                            members: [],
                            message:
                              error instanceof Error
                                ? error.message
                                : 'Could not load the members.',
                          });
                        })
                      }
                    >
                      Retry
                    </Button>
                  </div>
                )}
                {membersState.status === 'ready' &&
                  membersState.members.map((member) => {
                    const detail = groupMembers.find((item) => item.userId === member.userId);
                    const removing = busyId === `remove:${member.userId}`;
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
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`Remove ${member.name} from the topic`}
                            className="shrink-0"
                            disabled={busyId !== undefined}
                            onClick={() => void removeMember(member.userId)}
                          >
                            {removing ? 'Removing…' : 'Remove'}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                {isManager && addableMembers.length > 0 && (
                  <div className="mt-1 flex flex-col gap-1 px-2">
                    {memberPickerOpen ? (
                      <>
                        {addableMembers.map((member) => (
                          <button
                            key={member.userId}
                            type="button"
                            disabled={busyId !== undefined}
                            onClick={() => void addMember(member.userId)}
                            className={cn(
                              'flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-2 py-1.5 text-left text-[14px]',
                              'hover:bg-surface-raised disabled:opacity-50',
                            )}
                          >
                            <Avatar
                              id={member.userId}
                              name={member.name}
                              size={28}
                              avatarUrl={member.avatarUrl}
                            />
                            <span className="min-w-0 flex-1 truncate">{member.name}</span>
                            {busyId === `add:${member.userId}` && (
                              <span className="text-[12px] text-muted-foreground">Adding…</span>
                            )}
                          </button>
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
                    disabled={busyId !== undefined}
                    onClick={() => void leave()}
                  >
                    {busyId === 'leave' ? 'Leaving…' : 'Leave topic'}
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
                  onClick={() =>
                    void reloadAis().catch((error: unknown) => {
                      setAisState({
                        status: 'error',
                        ais: [],
                        message: error instanceof Error ? error.message : 'Could not load the AIs.',
                      });
                    })
                  }
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void reloadAis().catch((error: unknown) => {
                      setAisState({
                        status: 'error',
                        ais: [],
                        message: error instanceof Error ? error.message : 'Could not load the AIs.',
                      });
                    })
                  }
                >
                  Retry
                </Button>
              </div>
            )}
            {aisState.status === 'ready' &&
              aisState.ais.map((ai) => {
                const removing = busyId === `removeAi:${ai.id}`;
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
                    {canRemoveAi(ai.id) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Remove ${ai.name} from the topic`}
                        className="shrink-0"
                        disabled={busyId !== undefined}
                        onClick={() => void removeAi(ai.id)}
                      >
                        {removing ? 'Removing…' : 'Remove'}
                      </Button>
                    )}
                  </div>
                );
              })}
            {addableAis.length > 0 && (
              <div className="mt-1 flex flex-col gap-1 px-2">
                {aiPickerOpen ? (
                  <>
                    {addableAis.map((ai) => (
                      <button
                        key={ai.id}
                        type="button"
                        disabled={busyId !== undefined}
                        onClick={() => void addAi(ai.id)}
                        className={cn(
                          'flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-2 py-1.5 text-left text-[14px]',
                          'hover:bg-surface-raised disabled:opacity-50',
                        )}
                      >
                        <Avatar id={ai.jid} name={ai.name} size={28} ai avatarUrl={ai.avatarUrl} />
                        <span className="min-w-0 flex-1 truncate">{ai.name}</span>
                        <AiBadge />
                        {busyId === `addAi:${ai.id}` && (
                          <span className="text-[12px] text-muted-foreground">Adding…</span>
                        )}
                      </button>
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
          {topicId !== undefined && chat.groupId !== undefined && (
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
                      disabled={busyId !== undefined}
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
                      disabled={busyId !== undefined}
                      onClick={() => void flipVisibility()}
                    >
                      {busyId === 'visibility' ? 'Saving…' : 'Make private'}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="destructive"
                    size="lg"
                    className="self-start rounded-full px-4"
                    disabled={busyId !== undefined}
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
          confirmLabel={busyId === 'visibility' ? 'Making public…' : 'Make public'}
          onConfirm={() => void flipVisibility()}
          onCancel={() => setConfirmingVisibility(false)}
        />
      )}
      {confirmingArchive && (
        <ConfirmDialog
          title={`Archive “${chat.title}”?`}
          body="The topic disappears from the list for everyone. Its history stays on the server."
          confirmLabel={busyId === 'archive' ? 'Archiving…' : 'Archive'}
          onConfirm={() => void archive()}
          onCancel={() => setConfirmingArchive(false)}
        />
      )}
    </>
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
 * store so the chat row refreshes.
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
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const reload = async (): Promise<void> => {
    setRolesState({ status: 'loading', roles: [], approverRole: null, message: '' });
    try {
      const [topic, roles] = await Promise.all([getTopic(topicId), listGroupRoles(groupId)]);
      setGroupRoles(roles);
      setRolesState({
        status: 'ready',
        roles: topic.roles ?? [],
        approverRole: topic.approverRole ?? null,
        message: '',
      });
    } catch (error) {
      setRolesState({
        status: 'error',
        roles: [],
        approverRole: null,
        message: error instanceof Error ? error.message : 'Could not load the roles.',
      });
    }
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [topic, roles] = await Promise.all([getTopic(topicId), listGroupRoles(groupId)]);
        if (active) {
          setGroupRoles(roles);
          setRolesState({
            status: 'ready',
            roles: topic.roles ?? [],
            approverRole: topic.approverRole ?? null,
            message: '',
          });
        }
      } catch (error) {
        if (active) {
          setRolesState({
            status: 'error',
            roles: [],
            approverRole: null,
            message: error instanceof Error ? error.message : 'Could not load the roles.',
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [topicId, groupId]);

  const save = async (roleIds: string[], approverRoleId: string | null): Promise<void> => {
    setBusy(true);
    setErrorMessage('');
    try {
      await storeApi.getState().setTopicRoles(chatId, { roleIds, approverRoleId });
      await reload();
      setPickerOpen(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save the roles.');
    } finally {
      setBusy(false);
    }
  };

  const toggleRole = (roleId: string): void => {
    if (rolesState.status !== 'ready') {
      return;
    }
    const attached = rolesState.roles.some((role) => role.id === roleId);
    const roleIds = attached
      ? rolesState.roles.filter((role) => role.id !== roleId).map((role) => role.id)
      : [...rolesState.roles.map((role) => role.id), roleId];
    void save(roleIds, rolesState.approverRole?.id ?? null);
  };

  const pickApprover = (value: string): void => {
    if (rolesState.status !== 'ready') {
      return;
    }
    void save(
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
            onClick={() => void reload()}
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
                      <button
                        key={role.id}
                        type="button"
                        disabled={busy}
                        onClick={() => void toggleRole(role.id)}
                        className={cn(
                          'flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-2 py-1.5 text-left text-[14px]',
                          'hover:bg-surface-raised disabled:opacity-50',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{role.name}</span>
                        <span className="text-[12px] text-muted-foreground">
                          {role.members.length}
                        </span>
                      </button>
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
