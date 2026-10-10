import type { ChatSummary } from '@zilar/chat-core';
import { isAiJid, jidLocal } from '@zilar/protocol';
import { Effect, Option, Schema } from 'effect';
import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { PatchTopicInput, TopicStatus } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { useAction } from '@/lib/effect/use-action';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { Menu, MenuRadioItem } from '@/components/ui/menu';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';

const SAVE_FAILED = 'Could not save. Try again.';

interface TopicChange {
  readonly input: PatchTopicInput;
  /** Puts the topic back as it was before the optimistic change. */
  readonly rollback: () => void;
}

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
  const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.URLFromString)(trimmed));
  return parsed?.protocol === 'https:' ? parsed.toString() : undefined;
}

function linkText(chat: ChatSummary): string {
  const topic = chat.topic;
  if (topic?.linkLabel !== null && topic?.linkLabel !== undefined && topic.linkLabel !== '') {
    return topic.linkLabel;
  }
  const href = httpsUrl(topic?.linkUrl);
  if (href !== undefined) {
    return new URL(href).hostname;
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

  const saveTopic = (change: TopicChange) =>
    fromApi(() => storeApi.getState().patchTopic(chat.id, change.input)).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          change.rollback();
          setError(SAVE_FAILED);
        }),
      ),
    );
  // One action per kind of change: a status change and an owner change can
  // both be in flight. A second change of the same kind replaces the first.
  const [, runStatusSave] = useAction(saveTopic, { mode: 'replace' });
  const [, runOwnerSave] = useAction(saveTopic, { mode: 'replace' });
  const [, runLinkSave] = useAction(saveTopic, { mode: 'replace' });

  // Esc closes the link form. The status and owner menus close through
  // the kit Menu, whose document Escape handler stops propagation.
  useEffect(() => {
    if (!linkOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setLinkOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [linkOpen]);

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
    const localpart = jidLocal(jid);
    return localpart.startsWith('ai-') ? localpart.slice('ai-'.length) : localpart;
  };
  const members = candidates.filter((member) => !isAiJid(member.jid));
  const aiCandidates = candidates.filter((member) => isAiJid(member.jid));

  const restore =
    (previous: ChatSummary): (() => void) =>
    () => {
      storeApi.setState((state) => ({
        chats: state.chats.map((entry) => (entry.id === chat.id ? previous : entry)),
      }));
    };

  const startSave = (
    run: (change: TopicChange) => void,
    input: PatchTopicInput,
    rollback: () => void,
  ): void => {
    setError('');
    run({ input, rollback });
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
    startSave(runStatusSave, { status: next }, restore(previous));
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
    startSave(
      runOwnerSave,
      { owner: owner === null ? null : { kind: owner.kind, id: owner.id } },
      restore(previous),
    );
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
    startSave(runLinkSave, { linkUrl: nextUrl, linkLabel: nextLabel }, restore(previous));
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
        <Menu
          open={statusOpen}
          onClose={() => setStatusOpen(false)}
          label="Change status"
          closeLabel="Close status menu"
          className="top-full left-0 mt-1 min-w-[160px]"
        >
          {STATUS_ORDER.map((option) => (
            <MenuRadioItem
              key={option}
              checked={option === status}
              onSelect={() => chooseStatus(option)}
              className="text-[13px]"
            >
              <span
                className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[option])}
                aria-hidden="true"
              />
              {STATUS_LABEL[option]}
            </MenuRadioItem>
          ))}
        </Menu>
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
        <Menu
          open={ownerOpen}
          onClose={() => setOwnerOpen(false)}
          label="Change owner"
          closeLabel="Close owner picker"
          className="top-full left-0 mt-1 max-h-64 min-w-[180px] overflow-y-auto"
        >
          <MenuRadioItem
            checked={topic.owner === null}
            onSelect={() => chooseOwner(null)}
            className="text-[13px]"
          >
            No owner
          </MenuRadioItem>
          {members.map((member) => {
            const userId = ownerIdFor(member.jid);
            return (
              <MenuRadioItem
                key={member.jid}
                checked={topic.owner?.kind === 'user' && topic.owner.id === userId}
                onSelect={() => chooseOwner({ kind: 'user', id: userId, name: member.name })}
                className="text-[13px]"
              >
                {member.name}
              </MenuRadioItem>
            );
          })}
          {aiCandidates.map((member) => {
            const aiId = ownerIdFor(member.jid);
            return (
              <MenuRadioItem
                key={member.jid}
                checked={topic.owner?.kind === 'ai' && topic.owner.id === aiId}
                onSelect={() => chooseOwner({ kind: 'ai', id: aiId, name: member.name })}
                className="text-[13px]"
              >
                {member.name} (AI)
              </MenuRadioItem>
            );
          })}
        </Menu>
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
              <Button type="button" variant="ghost" size="sm" onClick={() => setLinkOpen(false)}>
                Cancel
              </Button>
              <Button type="button" variant="default" size="sm" onClick={saveLink}>
                Save
              </Button>
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
