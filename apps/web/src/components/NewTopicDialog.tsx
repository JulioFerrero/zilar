import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Avatar } from './Avatar';
import { AiBadge } from './AiBadge';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';
import type { GroupDetail, GroupRole, PublicAi, TopicKind, TopicVisibility } from '@/lib/api';
import { listGroupRoles } from '@/lib/api';

const TYPE_CHIPS: { kind: TopicKind; label: string }[] = [
  { kind: 'chat', label: 'Topic' },
  { kind: 'task', label: 'Task' },
  { kind: 'bug', label: 'Bug' },
  { kind: 'ui', label: 'UI' },
  { kind: 'routine', label: 'Routine' },
];

function glyphFor(name: string): string {
  const first = [...name.trim()][0] ?? 'G';
  return first.toUpperCase();
}

/**
 * The new-topic dialog (T-0111): name, type chips, a Public/Private
 * segmented control, and for private topics a people list (the creator ticked
 * and locked) plus the viewer's own AIs that are in the group. Create posts
 * the topic, then one AI add per ticked AI, then navigates to the new topic.
 */
export function NewTopicDialog({
  groupId,
  onClose,
}: {
  /** The group's chat id (a topic row id or the legacy group id). */
  groupId: string;
  onClose: () => void;
}) {
  const storeApi = useChatStoreApi();
  const store = useChatStore();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TopicKind>('chat');
  const [visibility, setVisibility] = useState<TopicVisibility>('public');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [selectedAis, setSelectedAis] = useState<string[]>([]);
  // T-0116: roles with access + the approver role, applied with one
  // `setTopicRoles` after the topic exists.
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [approverRoleId, setApproverRoleId] = useState<string | null>(null);
  const [groupRoles, setGroupRoles] = useState<GroupRole[]>([]);
  const [myAis, setMyAis] = useState<PublicAi[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const chat = store.chats.find((entry) => entry.id === groupId);
  // The group detail is keyed by the chat that loaded it (a topic row id or
  // the legacy group id); the loader runs for the id the dialog was opened
  // with, so that exact key is the one to read.
  const detail: GroupDetail | undefined = store.groupInfo(groupId);
  const me = store.currentUserId;

  useEffect(() => {
    storeApi.getState().refreshGroupInfo(groupId);
  }, [storeApi, groupId]);

  // The group's roles feed the Roles picker for private topics.
  useEffect(() => {
    let active = true;
    const id = detail?.id;
    if (id === undefined) {
      return;
    }
    listGroupRoles(id)
      .then((roles) => {
        if (active) {
          setGroupRoles(roles);
        }
      })
      .catch(() => {
        if (active) {
          setGroupRoles([]);
        }
      });
    return () => {
      active = false;
    };
  }, [detail?.id]);

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const members = detail?.members ?? [];
  const groupAis = detail?.ais ?? [];
  const myAisInGroup = myAis.filter((ai) => groupAis.some((item) => item.aiId === ai.id));
  const memberIds = visibility === 'private' ? [me, ...selectedMembers] : undefined;

  const toggleMember = (userId: string): void => {
    if (userId === me) {
      return;
    }
    setSelectedMembers((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  };

  const toggleAi = (aiId: string): void => {
    setSelectedAis((current) =>
      current.includes(aiId) ? current.filter((id) => id !== aiId) : [...current, aiId],
    );
  };

  const toggleRole = (roleId: string): void => {
    // Unpicking the approver role clears the Approvers select with it.
    if (selectedRoles.includes(roleId) && approverRoleId === roleId) {
      setApproverRoleId(null);
    }
    setSelectedRoles((current) =>
      current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId],
    );
  };

  const create = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Enter a topic name');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const chatJid = await storeApi.getState().createTopic(groupId, {
        name: trimmed.slice(0, 80),
        kind,
        visibility,
        glyph: glyphFor(trimmed),
        ...(memberIds === undefined ? {} : { memberIds }),
      });
      for (const aiId of selectedAis) {
        try {
          await storeApi.getState().addTopicAi(chatJid, aiId);
        } catch {
          // One AI failing must not lose the topic: the panel can add it.
        }
      }
      // T-0116: attach the picked roles (and approver) to the new private
      // topic. A failure here must not lose the topic either: the panel
      // can attach them.
      if (visibility === 'private' && selectedRoles.length > 0) {
        try {
          await storeApi.getState().setTopicRoles(chatJid, {
            roleIds: selectedRoles,
            approverRoleId,
          });
        } catch {
          // The topic exists; the panel can attach the roles.
        }
      }
      onClose();
      navigate(`/c/${encodeURIComponent(chatJid)}`);
    } catch {
      setBusy(false);
      setError('Could not create the topic. Try again.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New topic"
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-sm flex-col rounded-2xl border border-border bg-panel p-5 shadow-xl"
      >
        <h2 className="text-[18px] font-semibold">New topic</h2>
        <p className="mt-1 text-[14px] text-muted-foreground">
          in {detail?.title ?? chat?.groupTitle ?? 'the group'}
        </p>

        <label className="mt-4 flex flex-col gap-1">
          <span className="text-[14px] font-medium">Name</span>
          <input
            aria-label="Topic name"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Checkout bug"
            className="well-surface rounded-[10px] px-3 py-2 text-[15px] text-foreground outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
          />
        </label>

        <div className="mt-3 flex flex-col gap-1.5">
          <span id="new-topic-type" className="text-[14px] font-medium">
            Type
          </span>
          <div role="group" aria-labelledby="new-topic-type" className="flex flex-wrap gap-1.5">
            {TYPE_CHIPS.map((chip) => (
              <button
                key={chip.kind}
                type="button"
                aria-pressed={kind === chip.kind}
                onClick={() => setKind(chip.kind)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  kind === chip.kind
                    ? 'raised-segment border-border-strong text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          <span id="new-topic-visibility" className="text-[14px] font-medium">
            Who can see it
          </span>
          <div
            role="group"
            aria-labelledby="new-topic-visibility"
            className="well-surface grid grid-cols-2 gap-0.5 rounded-[10px] p-[3px]"
          >
            {(
              [
                { value: 'public', label: 'Public' },
                { value: 'private', label: 'Private' },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={visibility === option.value}
                onClick={() => setVisibility(option.value)}
                className={cn(
                  'h-[30px] rounded-[7px] text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  visibility === option.value
                    ? 'raised-segment text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-[13px] text-muted-foreground">
            {visibility === 'public'
              ? 'Everyone in the group can read and write here.'
              : 'Only the people you pick can see this topic — it stays hidden from everyone else, including group admins.'}
          </p>
        </div>

        {visibility === 'private' && (
          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            <span className="text-[14px] font-medium">People</span>
            {members.map((member) => {
              const locked = member.userId === me;
              const checked = locked || selectedMembers.includes(member.userId);
              return (
                <label
                  key={member.userId}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-list-hover"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    aria-label={`${member.name}${locked ? ' (you, always included)' : ''}`}
                    onChange={() => toggleMember(member.userId)}
                    className="size-4 accent-white"
                  />
                  <Avatar id={member.userId} name={member.name} size={28} />
                  <span className="min-w-0 flex-1 truncate text-[14px]">{member.name}</span>
                  {member.role !== 'member' && (
                    <span className="font-mono rounded-[5px] border border-badge-muted px-1 text-[10px] leading-[15px] text-muted-foreground">
                      {member.role}
                    </span>
                  )}
                </label>
              );
            })}
            {myAisInGroup.length > 0 && (
              <>
                <span className="mt-2 text-[14px] font-medium">My AIs in this group</span>
                <p className="text-[13px] text-muted-foreground">
                  AIs only read topics you add them to.
                </p>
                {myAisInGroup.map((ai) => {
                  const checked = selectedAis.includes(ai.id);
                  return (
                    <label
                      key={ai.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-list-hover"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-label={ai.name}
                        onChange={() => toggleAi(ai.id)}
                        className="size-4 accent-white"
                      />
                      <Avatar id={ai.jid} name={ai.name} size={28} ai />
                      <span className="min-w-0 flex-1 truncate text-[14px]">{ai.name}</span>
                      <AiBadge />
                    </label>
                  );
                })}
              </>
            )}
            {groupRoles.length > 0 && (
              <>
                <span className="mt-2 text-[14px] font-medium">Roles</span>
                <p className="text-[13px] text-muted-foreground">
                  Everyone holding a picked role can see this topic.
                </p>
                {groupRoles.map((role) => {
                  const checked = selectedRoles.includes(role.id);
                  return (
                    <label
                      key={role.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-list-hover"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-label={`${role.name} (${role.members.length})`}
                        onChange={() => toggleRole(role.id)}
                        className="size-4 accent-white"
                      />
                      <span className="min-w-0 flex-1 truncate text-[14px]">{role.name}</span>
                      <span className="text-[12px] text-muted-foreground">
                        {role.members.length}
                      </span>
                    </label>
                  );
                })}
                <label className="mt-1 flex flex-col gap-1">
                  <span className="text-[14px] font-medium">Approvers</span>
                  <select
                    aria-label="Approvers"
                    value={approverRoleId ?? ''}
                    onChange={(event) =>
                      setApproverRoleId(event.target.value === '' ? null : event.target.value)
                    }
                    className="well-surface rounded-[10px] px-3 py-2 text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <option value="">Owner and admins only</option>
                    {groupRoles
                      .filter((role) => selectedRoles.includes(role.id))
                      .map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
          </div>
        )}

        {error !== '' && (
          <p role="alert" className="mt-3 text-[13px] text-danger">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="rounded-full px-4"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="lg"
            className="rounded-full px-5"
            disabled={busy || name.trim().length === 0}
            onClick={() => void create()}
          >
            {busy ? 'Creating…' : 'Create topic'}
          </Button>
        </div>
      </div>
    </div>
  );
}
