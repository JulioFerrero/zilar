import type { ChatSummary } from '@galena/chat-core';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CreatedInviteLink, GroupAi, GroupInviteLink, GroupRole, PublicAi } from '@/lib/api';
import {
  createGroupInviteLink,
  createGroupRole,
  deleteGroupRole,
  listGroupInviteLinks,
  listGroupRoles,
  renameGroupRole,
  revokeGroupInviteLink,
  setGroupRoleMembers,
} from '@/lib/api';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
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
import { RoutinesSection } from './tools/RoutinesSection';
import { ToolsSection } from './tools/ToolsSection';

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function roleLabel(role: 'owner' | 'admin' | 'member'): string | undefined {
  return role === 'member' ? undefined : role;
}

/**
 * The group info panel: the people, the AIs (with their owner), add one of my
 * AIs, remove one. It slides in from the right on wide screens and fills the
 * screen on narrow ones, opened with `?panel=group` (T-0055).
 */
export function GroupPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const storeApi = useChatStoreApi();
  const store = useChatStore();
  const isWide = useMediaQuery('(min-width: 900px)');
  const panelRef = useRef<HTMLDivElement>(null);

  const info = store.groupInfo(chat.id);
  const me = store.currentUserId;
  const meRole = info?.members.find((member) => member.userId === me)?.role;
  const isManager = meRole === 'owner' || meRole === 'admin';
  const memberCount =
    info === undefined ? (chat.memberCount ?? 0) : info.members.length + info.ais.length;

  const [myAis, setMyAis] = useState<PublicAi[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addingId, setAddingId] = useState<string | undefined>(undefined);
  const [removingId, setRemovingId] = useState<string | undefined>(undefined);
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState('');
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchError, setSwitchError] = useState('');

  // T-0115: invite links for owners/admins. The list carries hints, never
  // tokens; the created URL is shown once with a Copy button. The load runs
  // through a small helper so the effect only synchronizes with the group id
  // (the lint rule flags synchronous setState inside effects).
  const groupId = info?.id;
  const [links, setLinks] = useState<GroupInviteLink[]>([]);
  const [linksBusy, setLinksBusy] = useState(false);
  const [linksError, setLinksError] = useState<string | undefined>(undefined);
  const [createdLink, setCreatedLink] = useState<CreatedInviteLink | undefined>(undefined);

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

  const [rolesState, setRolesState] = useState<{
    status: 'loading' | 'ready' | 'error';
    roles: GroupRole[];
    message: string;
  }>({ status: 'loading', roles: [], message: '' });

  // Custom group roles (T-0116): every member sees who holds what (the
  // chips below); managers get the CRUD section further down. A failure
  // shows an inline error with Retry and never breaks the rest of the
  // panel.
  useEffect(() => {
    let active = true;
    const groupId = info?.id;
    if (groupId === undefined) {
      return;
    }
    listGroupRoles(groupId)
      .then((roles) => {
        if (active) {
          setRolesState({ status: 'ready', roles, message: '' });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setRolesState({
            status: 'error',
            roles: [],
            message: error instanceof Error ? error.message : 'Could not load the roles.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [info?.id]);

  const reloadRoles = async (): Promise<void> => {
    if (info === undefined) {
      return;
    }
    setRolesState({ status: 'loading', roles: [], message: '' });
    try {
      setRolesState({ status: 'ready', roles: await listGroupRoles(info.id), message: '' });
    } catch (error) {
      setRolesState({
        status: 'error',
        roles: [],
        message: error instanceof Error ? error.message : 'Could not load the roles.',
      });
    }
  };

  const rolesByUser = new Map<string, GroupRole[]>();
  if (rolesState.status === 'ready') {
    for (const role of rolesState.roles) {
      for (const holder of role.members) {
        const list = rolesByUser.get(holder.userId) ?? [];
        list.push(role);
        rolesByUser.set(holder.userId, list);
      }
    }
  }

  const eligibleAis = myAis.filter(
    (ai) => ai.status === 'active' && info?.ais.some((item) => item.aiId === ai.id) !== true,
  );

  // The panel refreshes the members when it opens, so a change made elsewhere
  // shows up here. The AI list feeds the add picker.
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

  // Esc closes the panel. Capture phase so it beats ChatShell's window handler
  // that would otherwise navigate away on a narrow layout.
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

  const ownerName = (ai: GroupAi): string =>
    info?.members.find((member) => member.userId === ai.ownerId)?.name ?? 'someone';

  const flipTopicSwitch = async (): Promise<void> => {
    if (info === undefined || switchBusy) {
      return;
    }
    setSwitchBusy(true);
    setSwitchError('');
    try {
      await storeApi
        .getState()
        .setMembersCanCreateTopics(chat.id, info.membersCanCreateTopics !== true);
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : 'Could not save the setting.');
    } finally {
      setSwitchBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${chat.title} info`}
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
            <div className="truncate text-[16px] font-semibold">{chat.title}</div>
            <p className="text-[13px] text-muted-foreground">
              {memberCount} {memberCount === 1 ? 'member' : 'members'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close group panel"
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {info === undefined && <p className="text-[15px] text-muted-foreground">Loading…</p>}

          {info !== undefined && (
            <>
              <section aria-label="Members" className="flex flex-col gap-1">
                <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Members</h2>
                {info.members.map((member) => {
                  const label = roleLabel(member.role);
                  // Role chips for everyone (T-0116): the fresh roles list
                  // wins over the group detail's snapshot when both name a
                  // holder, so the chips stay right after an assignment.
                  const chipRoles = rolesByUser.get(member.userId) ?? member.roles ?? [];
                  return (
                    <div
                      key={member.userId}
                      className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
                    >
                      <Avatar id={member.userId} name={member.name} size={32} />
                      <span className="min-w-0 flex-1 truncate text-[14px]">{member.name}</span>
                      {chipRoles.map((role) => (
                        <span
                          key={role.id}
                          className="font-mono rounded-[5px] border border-badge-muted px-1 text-[10px] leading-[15px] text-muted-foreground"
                        >
                          {role.name}
                        </span>
                      ))}
                      {label !== undefined && (
                        <span className="font-mono rounded-[5px] border border-badge-muted px-1 text-[10px] leading-[15px] text-muted-foreground">
                          {label}
                        </span>
                      )}
                    </div>
                  );
                })}
              </section>

              {/* T-0116: custom group roles — managers only. Everyone sees
                  the chips next to the member names above. */}
              {isManager && info !== undefined && (
                <RolesSection
                  groupId={info.id}
                  members={info.members.map((member) => ({
                    userId: member.userId,
                    name: member.name,
                  }))}
                  rolesState={rolesState}
                  onReload={() => void reloadRoles()}
                />
              )}

              <section aria-label="AIs" className="flex flex-col gap-1">
                <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">AIs</h2>
                {info.ais.length === 0 && (
                  <p className="px-2 text-[13px] text-muted-foreground">
                    No AIs in this group yet.
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
                            aria-label={`Remove ${ai.name} from the group`}
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
                    {pickerOpen ? (
                      <div className="flex flex-col gap-1">
                        {eligibleAis.map((ai) => (
                          <button
                            key={ai.id}
                            type="button"
                            disabled={addingId !== undefined}
                            onClick={() => void add(ai.id)}
                            className={cn(
                              'flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-2 py-1.5 text-left text-[14px]',
                              'hover:bg-surface-raised disabled:opacity-50',
                            )}
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

              {/* T-0086: room activity for owners and admins. Plain members
                  get no section and no request is made. The section handles
                  its own load / error states; a failure here cannot break
                  the rest of the panel. */}
              {isManager && <ActivitySection scope={{ groupId: info.id }} />}

              {/* T-0100: the standing rules for this group, same visibility
                  as Activity — owners and admins only. */}
              {isManager && <AlwaysAllowedList scope={{ groupId: info.id }} />}

              {/* T-0107: tools and routines of the group (General). Plain
                  members read; managers get the actions. */}
              <ToolsSection
                scope={{ groupId: info.id }}
                scopeKey={`group:${info.id}`}
                canManage={isManager}
              />
              <RoutinesSection
                scope={{ groupId: info.id }}
                scopeKey={`group-routines:${info.id}`}
                canManage={isManager}
              />

              <PinsSection
                chatId={chat.id}
                onOpen={() => storeApi.getState().setPinsPanel(chat.id)}
              />

              {/* T-0115: shareable invite links, same visibility —
                  owners and admins only. */}
              {isManager && (
                <InviteLinksSection
                  links={links}
                  busy={linksBusy}
                  error={linksError}
                  created={createdLink === undefined ? undefined : { url: createdLink.url }}
                  onCreate={(input) => void createLink(input)}
                  onRevoke={(linkId) => void revokeLink(linkId)}
                  onDismissCreated={() => setCreatedLink(undefined)}
                />
              )}

              {/* T-0111: "Members can create topics", same visibility —
                  owners and admins only. */}
              {isManager && (
                <section aria-label="Topic settings" className="flex flex-col gap-2 px-2">
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2 py-1.5 hover:bg-list-hover">
                    <span className="text-[14px]">Members can create topics</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={info.membersCanCreateTopics === true}
                      aria-label="Members can create topics"
                      disabled={switchBusy}
                      onClick={() => void flipTopicSwitch()}
                      className={cn(
                        'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
                        info.membersCanCreateTopics === true ? 'bg-accent' : 'bg-surface-raised',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute top-0.5 size-5 rounded-full bg-foreground transition-all',
                          info.membersCanCreateTopics === true ? 'left-[22px]' : 'left-0.5',
                        )}
                      />
                    </button>
                  </label>
                  {switchError !== '' && <FieldError>{switchError}</FieldError>}
                </section>
              )}

              {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Custom group roles for managers (T-0116): create, rename, delete, and
 * assign with a member multi-select. A role grants private-topic access and
 * approver rights in the topics it is attached to — picked per topic in
 * the topic panel, not here.
 */
function RolesSection({
  groupId,
  members,
  rolesState,
  onReload,
}: {
  groupId: string;
  members: Array<{ userId: string; name: string }>;
  rolesState: { status: 'loading' | 'ready' | 'error'; roles: GroupRole[]; message: string };
  onReload: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | undefined>(undefined);
  const [renameValue, setRenameValue] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);
  const [assigningId, setAssigningId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setErrorMessage('');
    try {
      await work();
      onReload();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save the roles.');
    } finally {
      setBusy(false);
    }
  };

  const create = (): Promise<void> =>
    run(async () => {
      const name = newName.trim();
      if (name === '') {
        throw new Error('Enter a role name.');
      }
      await createGroupRole(groupId, name.slice(0, 30));
      setNewName('');
    });

  const rename = (roleId: string): Promise<void> =>
    run(async () => {
      const name = renameValue.trim();
      if (name === '') {
        throw new Error('Enter a role name.');
      }
      await renameGroupRole(groupId, roleId, name.slice(0, 30));
      setRenamingId(undefined);
    });

  const remove = (roleId: string): Promise<void> =>
    run(async () => {
      await deleteGroupRole(groupId, roleId);
      setConfirmingId(undefined);
    });

  const toggleHolder = (role: GroupRole, userId: string): Promise<void> => {
    const held = role.members.some((holder) => holder.userId === userId);
    const userIds = held
      ? role.members.filter((holder) => holder.userId !== userId).map((holder) => holder.userId)
      : [...role.members.map((holder) => holder.userId), userId];
    return run(() => setGroupRoleMembers(groupId, role.id, userIds).then(() => {}));
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
            onClick={onReload}
          >
            Retry
          </Button>
        </div>
      )}
      {rolesState.status === 'ready' && rolesState.roles.length === 0 && (
        <p className="px-2 text-[13px] text-muted-foreground">
          No roles yet. Roles grant private-topic access and approver rights.
        </p>
      )}
      {rolesState.status === 'ready' &&
        rolesState.roles.map((role) => {
          const renaming = renamingId === role.id;
          const confirming = confirmingId === role.id;
          const assigning = assigningId === role.id;
          return (
            <div key={role.id} className="flex flex-col gap-1 rounded-xl px-2 py-1.5">
              <div className="flex items-center gap-2">
                {renaming ? (
                  <input
                    aria-label={`Rename ${role.name}`}
                    value={renameValue}
                    maxLength={30}
                    onChange={(event) => setRenameValue(event.target.value)}
                    className="well-surface min-w-0 flex-1 rounded-[10px] px-3 py-1.5 text-[14px] text-foreground outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                    {role.name} ({role.members.length})
                  </span>
                )}
                {renaming ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void rename(role.id)}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setRenamingId(undefined)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : confirming ? (
                  <>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      aria-label={`Confirm deleting ${role.name}`}
                      disabled={busy}
                      onClick={() => void remove(role.id)}
                    >
                      Delete
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setConfirmingId(undefined)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Assign ${role.name}`}
                      className="shrink-0"
                      disabled={busy}
                      onClick={() => setAssigningId(assigning ? undefined : role.id)}
                    >
                      Assign
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Rename ${role.name}`}
                      className="shrink-0"
                      disabled={busy}
                      onClick={() => {
                        setRenameValue(role.name);
                        setRenamingId(role.id);
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${role.name}`}
                      className="shrink-0"
                      disabled={busy}
                      onClick={() => setConfirmingId(role.id)}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
              {assigning && !renaming && !confirming && (
                <div className="flex flex-col gap-1 pl-1">
                  {members.map((member) => {
                    const checked = role.members.some((holder) => holder.userId === member.userId);
                    return (
                      <label
                        key={member.userId}
                        className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-list-hover"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy}
                          aria-label={`${member.name} holds ${role.name}`}
                          onChange={() => void toggleHolder(role, member.userId)}
                          className="size-4 accent-white"
                        />
                        <Avatar id={member.userId} name={member.name} size={28} />
                        <span className="min-w-0 flex-1 truncate text-[14px]">{member.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      <div className="mt-1 flex items-center gap-2 px-2">
        <input
          aria-label="New role name"
          value={newName}
          maxLength={30}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="e.g. Designers"
          className="well-surface min-w-0 flex-1 rounded-[10px] px-3 py-2 text-[14px] text-foreground outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
        />
        <Button
          type="button"
          size="lg"
          className="shrink-0 rounded-full px-4"
          disabled={busy || newName.trim() === ''}
          onClick={() => void create()}
        >
          {busy ? 'Saving…' : 'Add role'}
        </Button>
      </div>
      {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}
    </section>
  );
}
