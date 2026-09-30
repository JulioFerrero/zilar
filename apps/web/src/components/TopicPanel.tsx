import type { ChatSummary } from '@galena/chat-core';
import { Lock, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Avatar } from './Avatar';
import { AiBadge } from './AiBadge';
import { ConfirmDialog } from './ConfirmDialog';
import { FieldError } from './ais/AiPageShell';
import { PinsSection } from './PinsPanel';
import { AlwaysAllowedList } from './approvals/AlwaysAllowedList';
import { Button } from './ui/button';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import {
  ApiError,
  getTopic,
  listGroupRoles,
  listTopicAis,
  listTopicMembers,
  listTopicTools,
  removeTopicAi,
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

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

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
  const isWide = useMediaQuery('(min-width: 900px)');
  const panelRef = useRef<HTMLDivElement>(null);

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

  // Esc closes the panel.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  // On a narrow layout the panel is the whole screen: keep Tab inside it.
  useEffect(() => {
    if (isWide) {
      return;
    }
    const root = panelRef.current;
    if (root === null) {
      return;
    }
    root.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') {
        return;
      }
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKeyDown);
    return () => root.removeEventListener('keydown', onKeyDown);
  }, [isWide]);

  if (topic === undefined) {
    return null;
  }

  const reloadMembers = async (): Promise<void> => {
    setMembersState({ status: 'loading', members: [], message: '' });
    try {
      setMembersState({ status: 'ready', members: await listTopicMembers(topic.id), message: '' });
    } catch (error) {
      setMembersState({
        status: 'error',
        members: [],
        message: error instanceof Error ? error.message : 'Could not load the members.',
      });
    }
  };

  const reloadAis = async (): Promise<void> => {
    setAisState({ status: 'loading', ais: [], message: '' });
    try {
      setAisState({ status: 'ready', ais: await listTopicAis(topic.id), message: '' });
    } catch (error) {
      setAisState({
        status: 'error',
        ais: [],
        message: error instanceof Error ? error.message : 'Could not load the AIs.',
      });
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
      await reloadMembers();
      setMemberPickerOpen(false);
    });

  const removeMember = (userId: string): Promise<void> =>
    run(`remove:${userId}`, async () => {
      // ONE call: the store issues the DELETE and folds the row back in
      // (real) or drops it when archived (both). A 404 alone never means
      // "the topic is gone" — the server also 404s for a user who is not a
      // member — so only navigate away when the refreshed list no longer
      // has the topic row. Any other failure keeps the user here with the
      // inline error.
      try {
        await storeApi.getState().removeTopicMember(chat.id, userId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          const gone = await storeApi.getState().refreshTopicRow(chat.id, topic.id);
          if (gone) {
            navigate('/');
            onClose();
            return;
          }
          await reloadMembers();
          return;
        }
        throw error;
      }
      await reloadMembers();
    });

  const leave = (): Promise<void> =>
    run('leave', async () => {
      try {
        await storeApi.getState().leaveTopic(chat.id);
      } catch (error) {
        // Leaving the last seat archives the topic (server 404): it is
        // gone, so navigate away. Any other failure (network, 403) means
        // the caller is still a member — stay with the inline error.
        if (error instanceof ApiError && error.status === 404) {
          navigate('/');
          onClose();
          return;
        }
        throw error;
      }
      navigate('/');
      onClose();
    });

  const addAi = (aiId: string): Promise<void> =>
    run(`addAi:${aiId}`, async () => {
      // ONE call: the store issues the POST and folds the row back in.
      await storeApi.getState().addTopicAi(chat.id, aiId);
      await reloadAis();
      setAiPickerOpen(false);
    });

  const removeAi = (aiId: string): Promise<void> =>
    run(`removeAi:${aiId}`, async () => {
      await removeTopicAi(topic.id, aiId);
      await storeApi
        .getState()
        .removeTopicAi(chat.id, aiId)
        .catch(() => {});
      await reloadAis();
    });

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
      await reloadMembers();
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${chat.title} topic info`}
      onClick={onClose}
      className="fixed inset-0 z-40 flex justify-end bg-black/40"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full flex-col bg-surface shadow-xl outline-none sm:w-[380px]"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-divider p-4">
          <Avatar id={chat.id} name={chat.title} size={44} />
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
          <button
            type="button"
            aria-label="Close topic panel"
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <section aria-label="Members" className="flex flex-col gap-1">
            <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Members</h2>
            {isPrivate ? (
              <>
                {membersState.status === 'loading' && (
                  <p className="px-2 text-[13px] text-muted-foreground">Loading…</p>
                )}
                {membersState.status === 'error' && (
                  <div className="flex flex-col gap-2 px-2">
                    <FieldError>{membersState.message}</FieldError>
                    <Button
                      type="button"
                      size="lg"
                      className="self-start rounded-full px-4"
                      onClick={() => void reloadMembers()}
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
                        <Avatar id={member.userId} name={member.name} size={32} />
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
                            <Avatar id={member.userId} name={member.name} size={28} />
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
              <p className="px-2 text-[13px] text-muted-foreground">Loading…</p>
            )}
            {aisState.status === 'error' && (
              <div className="flex flex-col gap-2 px-2">
                <FieldError>{aisState.message}</FieldError>
                <Button
                  type="button"
                  size="lg"
                  className="self-start rounded-full px-4"
                  onClick={() => void reloadAis()}
                >
                  Retry
                </Button>
              </div>
            )}
            {aisState.status === 'ready' && aisState.ais.length === 0 && (
              <p className="px-2 text-[13px] text-muted-foreground">No AIs in this topic yet.</p>
            )}
            {aisState.status === 'ready' &&
              aisState.ais.map((ai) => {
                const removing = busyId === `removeAi:${ai.id}`;
                return (
                  <div
                    key={ai.id}
                    className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
                  >
                    <Avatar id={ai.id} name={ai.name} size={32} ai />
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
                        <Avatar id={ai.jid} name={ai.name} size={28} ai />
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
      </div>

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
    </div>
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
        <p className="px-2 text-[13px] text-muted-foreground">Loading…</p>
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
