import type { ChatSummary } from '@zilar/chat-core';
import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { PatchTopicInput, TopicStatus } from '@/lib/api';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { TextInput } from '@/components/ui/text-input';

const STATUS_ORDER: TopicStatus[] = ['open', 'in_progress', 'in_review', 'blocked', 'done'];

const STATUS_LABEL: Record<TopicStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  in_review: 'In review',
  blocked: 'Blocked',
  done: 'Done',
};

// The status dot is always paired with its text, never color alone.
const STATUS_DOT: Record<TopicStatus, string> = {
  open: 'bg-[#8a8a8a]',
  in_progress: 'bg-amber-400',
  in_review: 'bg-blue-400',
  blocked: 'bg-red-400',
  done: 'bg-green-400',
};

function typeLabel(chat: ChatSummary): string {
  const topic = chat.topic;
  if (topic === undefined) {
    return 'TOPIC';
  }
  if (topic.isGeneral) {
    return 'GENERAL';
  }
  switch (topic.kind) {
    case 'task':
      return 'TASK';
    case 'bug':
      return 'BUG';
    case 'ui':
      return 'UI';
    case 'routine':
      return 'ROUTINE';
    default:
      return 'TOPIC';
  }
}

function ownerLabel(chat: ChatSummary): string {
  const owner = chat.topic?.owner;
  if (owner === null || owner === undefined) {
    return 'No owner';
  }
  return `Owner: ${owner.name}`;
}

/** Only `https:` URLs render as links; anything else renders as plain text. */
export function httpsUrl(url: string | null | undefined): string | undefined {
  if (url === null || url === undefined) {
    return undefined;
  }
  const trimmed = url.trim();
  if (trimmed === '') {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function linkText(chat: ChatSummary): string {
  const topic = chat.topic;
  if (topic?.linkLabel !== null && topic?.linkLabel !== undefined && topic.linkLabel !== '') {
    return topic.linkLabel;
  }
  const href = httpsUrl(topic?.linkUrl);
  if (href !== undefined) {
    try {
      return new URL(href).hostname;
    } catch {
      return href;
    }
  }
  return 'Add link';
}

/**
 * The task strip under the chat header (T-0111), on every topic: the type
 * chip, the status chip (dot + text), the owner, and the link. Anyone who
 * can see the topic can edit: status via a menu, owner via a picker of topic
 * members and AIs, link via a small URL + label form. Optimistic with
 * rollback and an inline error.
 */
export function TaskStrip({ chat }: { chat: ChatSummary }) {
  const storeApi = useChatStoreApi();
  const topic = chat.topic;
  const [statusOpen, setStatusOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [error, setError] = useState('');

  // Esc closes any open menu or form.
  useEffect(() => {
    if (!statusOpen && !ownerOpen && !linkOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setStatusOpen(false);
        setOwnerOpen(false);
        setLinkOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [statusOpen, ownerOpen, linkOpen]);

  if (topic === undefined) {
    return null;
  }

  const status = topic.status;
  const href = httpsUrl(topic.linkUrl);
  const candidates = storeApi.getState().groupMembers(chat.id);
  // The strip owner id is the server's id: a bare user id for people, the
  // full AI id for AIs. Derive it the same way for both kinds by stripping
  // the mention JID's domain (users are `<id>@<domain>`, AIs
  // `ai-<id>@<domain>`), never by display name: two AIs can share a name.
  const ownerIdFor = (jid: string): string => {
    const localpart = jid.split('@')[0] ?? jid;
    return localpart.startsWith('ai-') ? localpart.slice('ai-'.length) : localpart;
  };
  const members = candidates.filter((member) => !member.jid.startsWith('ai-'));
  const aiCandidates = candidates.filter((member) => member.jid.startsWith('ai-'));

  const patch = async (input: PatchTopicInput, rollback: () => void): Promise<void> => {
    setError('');
    try {
      await storeApi.getState().patchTopic(chat.id, input);
    } catch {
      rollback();
      setError('Could not save. Try again.');
    }
  };

  const chooseStatus = (next: TopicStatus): void => {
    setStatusOpen(false);
    if (next === status) {
      return;
    }
    const previous = chat;
    storeApi.setState((state) => ({
      chats: state.chats.map((entry) =>
        entry.id === chat.id && entry.topic !== undefined
          ? { ...entry, topic: { ...entry.topic, status: next } }
          : entry,
      ),
    }));
    void patch({ status: next }, () => {
      storeApi.setState((state) => ({
        chats: state.chats.map((entry) => (entry.id === chat.id ? previous : entry)),
      }));
    });
  };

  const chooseOwner = (owner: { kind: 'user' | 'ai'; id: string; name: string } | null): void => {
    setOwnerOpen(false);
    const previous = chat;
    const same =
      (owner === null && topic.owner === null) ||
      (owner !== null &&
        topic.owner !== null &&
        owner.kind === topic.owner.kind &&
        owner.id === topic.owner.id);
    if (same) {
      return;
    }
    storeApi.setState((state) => ({
      chats: state.chats.map((entry) =>
        entry.id === chat.id && entry.topic !== undefined
          ? {
              ...entry,
              topic: {
                ...entry.topic,
                owner: owner === null ? null : { kind: owner.kind, id: owner.id, name: owner.name },
              },
            }
          : entry,
      ),
    }));
    void patch({ owner: owner === null ? null : { kind: owner.kind, id: owner.id } }, () => {
      storeApi.setState((state) => ({
        chats: state.chats.map((entry) => (entry.id === chat.id ? previous : entry)),
      }));
    });
  };

  const saveLink = (): void => {
    const trimmed = linkUrl.trim();
    if (trimmed !== '' && httpsUrl(trimmed) === undefined) {
      setError('Link must be an https URL.');
      return;
    }
    setLinkOpen(false);
    const previous = chat;
    const nextUrl = trimmed === '' ? null : trimmed;
    const nextLabel = linkLabel.trim() === '' ? null : linkLabel.trim().slice(0, 40);
    storeApi.setState((state) => ({
      chats: state.chats.map((entry) =>
        entry.id === chat.id && entry.topic !== undefined
          ? { ...entry, topic: { ...entry.topic, linkUrl: nextUrl, linkLabel: nextLabel } }
          : entry,
      ),
    }));
    void patch({ linkUrl: nextUrl, linkLabel: nextLabel }, () => {
      storeApi.setState((state) => ({
        chats: state.chats.map((entry) => (entry.id === chat.id ? previous : entry)),
      }));
    });
  };

  return (
    <div
      aria-label="Topic details"
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-divider bg-panel px-4 py-2"
    >
      <span className="font-mono rounded-[5px] border border-badge-muted px-1.5 text-[10px] leading-[18px] font-semibold tracking-wide text-muted-foreground">
        {typeLabel(chat)}
      </span>

      <div className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={statusOpen}
          aria-label={`Status: ${STATUS_LABEL[status]}. Change status`}
          onClick={() => {
            setStatusOpen((value) => !value);
            setOwnerOpen(false);
            setLinkOpen(false);
          }}
          className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[12px] font-medium text-foreground hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <span
            className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[status])}
            aria-hidden="true"
          />
          {STATUS_LABEL[status]}
        </button>
        {statusOpen && (
          <>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close status menu"
              onClick={() => setStatusOpen(false)}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div
              role="menu"
              aria-label="Change status"
              className="absolute top-full left-0 z-20 mt-1 min-w-[160px] rounded-xl border border-border bg-popover py-1 shadow-lg"
            >
              {STATUS_ORDER.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option === status}
                  onClick={() => chooseStatus(option)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none"
                >
                  <span
                    className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[option])}
                    aria-hidden="true"
                  />
                  {STATUS_LABEL[option]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={ownerOpen}
          aria-label={`${ownerLabel(chat)}. Change owner`}
          onClick={() => {
            setOwnerOpen((value) => !value);
            setStatusOpen(false);
            setLinkOpen(false);
          }}
          className="rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {ownerLabel(chat)}
        </button>
        {ownerOpen && (
          <>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close owner picker"
              onClick={() => setOwnerOpen(false)}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div
              role="menu"
              aria-label="Change owner"
              className="absolute top-full left-0 z-20 mt-1 max-h-64 min-w-[180px] overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={topic.owner === null}
                onClick={() => chooseOwner(null)}
                className="flex w-full items-center px-3 py-2 text-left text-[13px] hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none"
              >
                No owner
              </button>
              {members.map((member) => {
                const userId = ownerIdFor(member.jid);
                return (
                  <button
                    key={member.jid}
                    type="button"
                    role="menuitemradio"
                    aria-checked={topic.owner?.kind === 'user' && topic.owner.id === userId}
                    onClick={() => chooseOwner({ kind: 'user', id: userId, name: member.name })}
                    className="flex w-full items-center px-3 py-2 text-left text-[13px] hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none"
                  >
                    {member.name}
                  </button>
                );
              })}
              {aiCandidates.map((member) => {
                const aiId = ownerIdFor(member.jid);
                return (
                  <button
                    key={member.jid}
                    type="button"
                    role="menuitemradio"
                    aria-checked={topic.owner?.kind === 'ai' && topic.owner.id === aiId}
                    onClick={() => chooseOwner({ kind: 'ai', id: aiId, name: member.name })}
                    className="flex w-full items-center px-3 py-2 text-left text-[13px] hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none"
                  >
                    {member.name} (AI)
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="relative flex shrink-0 items-center">
        {href !== undefined ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <ExternalLink className="size-3" aria-hidden="true" />
            <span className="max-w-40 truncate">{linkText(chat)}</span>
          </a>
        ) : (
          <button
            type="button"
            aria-label="Add topic link"
            onClick={() => {
              setLinkUrl(topic.linkUrl ?? '');
              setLinkLabel(topic.linkLabel ?? '');
              setLinkOpen((value) => !value);
              setStatusOpen(false);
              setOwnerOpen(false);
            }}
            className="rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {linkText(chat)}
          </button>
        )}
        {href !== undefined && (
          <button
            type="button"
            aria-label="Edit topic link"
            onClick={() => {
              setLinkUrl(topic.linkUrl ?? '');
              setLinkLabel(topic.linkLabel ?? '');
              setLinkOpen((value) => !value);
              setStatusOpen(false);
              setOwnerOpen(false);
            }}
            className="ml-1 rounded-full px-1.5 py-1 text-[12px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Edit
          </button>
        )}
        {linkOpen && (
          <div className="absolute top-full left-0 z-20 mt-1 flex w-64 flex-col gap-2 rounded-xl border border-border bg-popover p-3 shadow-lg">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium">URL (https only)</span>
              <TextInput
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder="https://…"
                inputMode="url"
                className="rounded-[8px] px-2.5 py-1.5 text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium">Label (optional)</span>
              <TextInput
                value={linkLabel}
                onChange={(event) => setLinkLabel(event.target.value)}
                maxLength={40}
                placeholder="PR #42"
                className="rounded-[8px] px-2.5 py-1.5 text-[13px]"
              />
            </label>
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setLinkOpen(false)}
                className="rounded-full px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveLink}
                className="key-primary rounded-full px-3 py-1.5 text-[13px] font-semibold"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      {error !== '' && (
        <span role="alert" className="text-[12px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
