import type { ChatSummary } from '@zilar/chat-core';
import { Megaphone, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { CreatedInviteLink, GroupAi, GroupInviteLink, GroupMember, PublicAi } from '@/lib/api';
import {
  createGroupInviteLink,
  listGroupInviteLinks,
  listGroupMembers,
  revokeGroupInviteLink,
} from '@/lib/api';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';
import { ActivitySection } from './ais/AiActivity';
import { AlwaysAllowedList } from './approvals/AlwaysAllowedList';
import { PinsSection } from './PinsPanel';
import { AiBadge } from './AiBadge';
import { FieldError } from './ais/AiPageShell';
import { describeAiError } from './ais/errors';
import { Avatar } from './Avatar';
import { Button } from './ui/button';
import { InviteLinksSection } from './InviteLinksSection';
import { VisibilitySection } from './VisibilitySection';

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function roleLabel(role: 'owner' | 'admin' | 'member'): string | undefined {
  return role === 'member' ? undefined : role;
}

/**
 * The channel info panel (T-0124): the feed's description, the subscriber
 * count, invite links (admins), admins management (owner), the AIs that post
 * (admin-level, voice-gated by the room), and Leave channel for subscribers.
 * The subscriber audience is visible to admins only — subscribers see the
 * count plus who posts (the admins slice, which is public the way every
 * admin post carries its name), never the audience.
 */
export function ChannelPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const storeApi = useChatStoreApi();
  const store = useChatStore();
  const navigate = useNavigate();
  const isWide = useMediaQuery('(min-width: 900px)');
  const panelRef = useRef<HTMLDivElement>(null);

  const info = store.groupInfo(chat.id);
  const me = store.currentUserId;
  const meRole = info?.members.find((member) => member.userId === me)?.role;
  const isManager = meRole === 'owner' || meRole === 'admin';
  const isOwner = meRole === 'owner';
  const count = chat.subscriberCount ?? chat.memberCount ?? info?.members.length ?? 0;
  const description = chat.description ?? info?.description ?? null;

  const [myAis, setMyAis] = useState<PublicAi[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addingId, setAddingId] = useState<string | undefined>(undefined);
  const [removingId, setRemovingId] = useState<string | undefined>(undefined);
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleError, setRoleError] = useState('');

  const groupId = info?.id;
  const [links, setLinks] = useState<GroupInviteLink[]>([]);
  const [linksBusy, setLinksBusy] = useState(false);
  const [linksError, setLinksError] = useState<string | undefined>(undefined);
  const [createdLink, setCreatedLink] = useState<CreatedInviteLink | undefined>(undefined);

  // T-0124: subscribers never see the audience (`GET /api/groups/:id`
  // strips `members` for them), but the Admins section still names who
  // posts: the members endpoint answers the admins slice to subscribers
  // (owner/admins only — who posts is public, every admin post carries its
  // name — while the subscriber audience stays hidden). Managers read the
  // full list from the detail they already hold, so no second request.
  const [adminsState, setAdminsState] = useState<{
    status: 'loading' | 'ready' | 'error';
    admins: GroupMember[];
    message: string;
  }>({ status: 'loading', admins: [], message: '' });

  useEffect(() => {
    if (groupId === undefined) {
      return;
    }
    if (isManager) {
      return;
    }
    let active = true;
    listGroupMembers(groupId)
      .then((members) => {
        if (active) {
          setAdminsState({
            status: 'ready',
            admins: members.filter((member) => member.role !== 'member'),
            message: '',
          });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setAdminsState({
            status: 'error',
            admins: [],
            message: error instanceof Error ? error.message : 'Could not load the admins.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [groupId, isManager]);

  useEffect(() => {
    if (!isManager || groupId === undefined) {
      return;
    }
    let active = true;
    void loadLinks(groupId).then((result) => {
      if (active) {
        setLinks(result.links);
        setLinksError(result.error);
        setLinksBusy(false);
      }
    });
    return () => {
      active = false;
    };
    async function loadLinks(
      id: string,
    ): Promise<{ links: GroupInviteLink[]; error: string | undefined }> {
      try {
        return { links: await listGroupInviteLinks(id), error: undefined };
      } catch {
        return { links: [], error: 'Could not load the invite links.' };
      }
    }
  }, [isManager, groupId]);

  const createLink = async (input: {
    label?: string;
    expiresInHours?: number;
    maxUses?: number;
  }): Promise<void> => {
    if (groupId === undefined || linksBusy) {
      return;
    }
    setLinksBusy(true);
    setLinksError(undefined);
    try {
      const created = await createGroupInviteLink(groupId, input);
      setCreatedLink(created);
      setLinks(await listGroupInviteLinks(groupId));
    } catch (error) {
      setLinksError(error instanceof Error ? error.message : 'Could not create the link.');
    } finally {
      setLinksBusy(false);
    }
  };

  const revokeLink = async (linkId: string): Promise<void> => {
    if (groupId === undefined) {
      return;
    }
    try {
      await revokeGroupInviteLink(groupId, linkId);
      setLinks(await listGroupInviteLinks(groupId));
    } catch (error) {
      setLinksError(error instanceof Error ? error.message : 'Could not revoke the link.');
    }
  };

  const eligibleAis = myAis.filter(
    (ai) => ai.status === 'active' && info?.ais.some((item) => item.aiId === ai.id) !== true,
  );

  useEffect(() => {
    storeApi.getState().refreshGroupInfo(chat.id);
  }, [storeApi, chat.id]);

  useEffect(() => {
    let active = true;
    storeApi
      .getState()
      .listMyAis()
      .then((list) => {
        if (active) {
          setMyAis(list);
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

  const add = async (aiId: string): Promise<void> => {
    setAddingId(aiId);
    setErrorMessage('');
    try {
      await storeApi.getState().addGroupAi(chat.id, aiId);
      setPickerOpen(false);
    } catch (error) {
      setErrorMessage(describeAiError(error, 'Could not add the AI').message);
    } finally {
      setAddingId(undefined);
    }
  };

  const remove = async (aiId: string): Promise<void> => {
    setRemovingId(aiId);
    setErrorMessage('');
    try {
      await storeApi.getState().removeGroupAi(chat.id, aiId);
      setConfirmingId(undefined);
    } catch (error) {
      setErrorMessage(describeAiError(error, 'Could not remove the AI').message);
    } finally {
      setRemovingId(undefined);
    }
  };

  const leave = async (): Promise<void> => {
    if (leaving) {
      return;
    }
    setLeaving(true);
    setLeaveError('');
    try {
      await storeApi.getState().leaveChannel(chat.id);
      onClose();
      navigate('/');
    } catch (error) {
      setLeaveError(error instanceof Error ? error.message : 'Could not leave the channel.');
      setLeaving(false);
    }
  };

  const flipRole = async (userId: string, role: 'admin' | 'member'): Promise<void> => {
    if (roleBusy) {
      return;
    }
    setRoleBusy(true);
    setRoleError('');
    try {
      await storeApi.getState().changeChannelRole(chat.id, userId, role);
    } catch (error) {
      setRoleError(error instanceof Error ? error.message : 'Could not change the role.');
    } finally {
      setRoleBusy(false);
    }
  };

  const ownerName = (ai: GroupAi): string =>
    info?.members.find((member) => member.userId === ai.ownerId)?.name ??
    adminsState.admins.find((member) => member.userId === ai.ownerId)?.name ??
    'someone';

  // The audience list: admins see everyone (names + roles) from the detail;
  // subscribers see only who posts (the admins slice, loaded above) — the
  // subscriber audience stays hidden everywhere.
  const audience = isManager ? (info?.members ?? []) : [];
  const admins = isManager
    ? audience.filter((member) => member.role !== 'member')
    : adminsState.admins;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${chat.title} channel info`}
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
            <div className="flex items-center gap-1.5">
              <div className="truncate text-[16px] font-semibold">{chat.title}</div>
              <Megaphone aria-label="Channel" className="size-4 shrink-0 text-subtle-foreground" />
            </div>
            <p className="text-[13px] text-muted-foreground">
              {count} {count === 1 ? 'subscriber' : 'subscribers'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close channel panel"
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {description !== null && description !== '' && (
            <section aria-label="Description" className="px-2">
              <p className="text-[14px] text-muted-foreground">{description}</p>
            </section>
          )}

          {info === undefined && <p className="text-[15px] text-muted-foreground">Loading…</p>}

          {info !== undefined && (
            <>
              {isManager ? (
                <section aria-label="Subscribers" className="flex flex-col gap-1">
                  <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">
                    Subscribers
                  </h2>
                  {audience.map((member) => {
                    const label = roleLabel(member.role);
                    const canFlip = isOwner && member.userId !== me;
                    return (
                      <div
                        key={member.userId}
                        className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
                      >
                        <Avatar id={member.userId} name={member.name} size={32} />
                        <span className="min-w-0 flex-1 truncate text-[14px]">{member.name}</span>
                        {label !== undefined && (
                          <span className="font-mono rounded-[5px] border border-badge-muted px-1 text-[10px] leading-[15px] text-muted-foreground">
                            {label}
                          </span>
                        )}
                        {canFlip && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={
                              member.role === 'admin'
                                ? `Demote ${member.name} to subscriber`
                                : `Promote ${member.name} to admin`
                            }
                            className="shrink-0"
                            disabled={roleBusy}
                            onClick={() =>
                              void flipRole(
                                member.userId,
                                member.role === 'admin' ? 'member' : 'admin',
                              )
                            }
                          >
                            {member.role === 'admin' ? 'Demote' : 'Promote'}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  {roleError !== '' && <FieldError>{roleError}</FieldError>}
                </section>
              ) : (
                <section aria-label="Admins" className="flex flex-col gap-1">
                  <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Admins</h2>
                  {adminsState.status === 'loading' && (
                    <p className="px-2 text-[13px] text-muted-foreground">Loading…</p>
                  )}
                  {adminsState.status === 'error' && <FieldError>{adminsState.message}</FieldError>}
                  {adminsState.status === 'ready' && admins.length === 0 && (
                    <p className="px-2 text-[13px] text-muted-foreground">
                      Only admins can post here.
                    </p>
                  )}
                  {admins.map((member) => (
                    <div
                      key={member.userId}
                      className="flex items-center gap-2 rounded-xl px-2 py-1.5"
                    >
                      <Avatar id={member.userId} name={member.name} size={32} />
                      <span className="min-w-0 flex-1 truncate text-[14px]">{member.name}</span>
                    </div>
                  ))}
                </section>
              )}

              <section aria-label="AIs" className="flex flex-col gap-1">
                <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">AIs</h2>
                {info.ais.length === 0 && (
                  <p className="px-2 text-[13px] text-muted-foreground">
                    No AIs post in this channel yet.
                  </p>
                )}
                {info.ais.map((ai) => {
                  const canRemove = ai.ownerId === me || isManager;
                  const confirming = confirmingId === ai.aiId;
                  const removing = removingId === ai.aiId;
                  return (
                    <div
                      key={ai.aiId}
                      className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
                    >
                      <Avatar id={ai.jid} name={ai.name} size={32} ai />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[14px]">{ai.name}</span>
                          <AiBadge />
                        </div>
                        <p className="truncate text-[12px] text-muted-foreground">
                          Added by {ownerName(ai)}
                        </p>
                      </div>
                      {canRemove &&
                        (confirming ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              aria-label={`Confirm removing ${ai.name}`}
                              disabled={removing}
                              onClick={() => void remove(ai.aiId)}
                            >
                              {removing ? 'Removing…' : 'Remove'}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={removing}
                              onClick={() => setConfirmingId(undefined)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`Remove ${ai.name} from the channel`}
                            className="shrink-0"
                            onClick={() => setConfirmingId(ai.aiId)}
                          >
                            Remove
                          </Button>
                        ))}
                    </div>
                  );
                })}

                {isManager && eligibleAis.length > 0 && (
                  <div className="mt-1 flex flex-col gap-2 px-2">
                    <p className="text-[12px] text-muted-foreground">
                      An AI posts here only when its owner is a channel admin.
                    </p>
                    {pickerOpen ? (
                      <div className="flex flex-col gap-1">
                        {eligibleAis.map((ai) => (
                          <button
                            key={ai.id}
                            type="button"
                            disabled={addingId !== undefined}
                            onClick={() => void add(ai.id)}
                            className="flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-2 py-1.5 text-left text-[14px] hover:bg-surface-raised disabled:opacity-50"
                          >
                            <Avatar id={ai.jid} name={ai.name} size={28} ai />
                            <span className="min-w-0 flex-1 truncate">{ai.name}</span>
                            <AiBadge />
                            {addingId === ai.id && (
                              <span className="text-[12px] text-muted-foreground">Adding…</span>
                            )}
                          </button>
                        ))}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="self-start"
                          disabled={addingId !== undefined}
                          onClick={() => setPickerOpen(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="lg"
                        className="self-start rounded-full px-4"
                        onClick={() => setPickerOpen(true)}
                      >
                        Add my AI
                      </Button>
                    )}
                  </div>
                )}
              </section>

              {isManager && <ActivitySection scope={{ groupId: info.id }} />}

              {isManager && <AlwaysAllowedList scope={{ groupId: info.id }} />}

              <PinsSection
                chatId={chat.id}
                onOpen={() => storeApi.getState().setPinsPanel(chat.id)}
              />

              {isManager && (
                <InviteLinksSection
                  links={links}
                  busy={linksBusy}
                  error={linksError}
                  created={createdLink === undefined ? undefined : { url: createdLink.url }}
                  onCreate={(input) => void createLink(input)}
                  // Returns the DELETE promise so the section keeps the
                  // button busy until the revoke settles (T-0141).
                  onRevoke={(linkId) => revokeLink(linkId)}
                  onDismissCreated={() => setCreatedLink(undefined)}
                />
              )}

              {/* T-0164: public visibility with a handle — the owner only. */}
              {isOwner && info !== undefined && (
                <VisibilitySection
                  chatId={chat.id}
                  groupId={info.id}
                  visibility={info.visibility ?? 'private'}
                  handle={info.handle ?? null}
                  title={info.title}
                />
              )}

              {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}

              {!isManager && (
                <div className="flex flex-col gap-2 px-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="self-start rounded-full px-4"
                    disabled={leaving}
                    onClick={() => void leave()}
                  >
                    {leaving ? 'Leaving…' : 'Leave channel'}
                  </Button>
                  {leaveError !== '' && <FieldError>{leaveError}</FieldError>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
