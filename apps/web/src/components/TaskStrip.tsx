import type { ChatSummary, TopicInfo } from '@zilar/chat-core';
import { Effect } from 'effect';
import { useEffect, useState } from 'react';
import type { PatchTopicInput, TopicOwner, TopicStatus } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { useAction } from '@/lib/effect/use-action';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { LinkEditor } from './topic/LinkEditor';
import { OwnerMenu } from './topic/OwnerMenu';
import { StatusMenu } from './topic/StatusMenu';
import {
  httpsUrl,
  linkText,
  ownerLabel,
  SAVE_FAILED,
  typeLabel,
  type TopicChange,
} from './topic/stripModel';

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

  const restore =
    (previous: ChatSummary): (() => void) =>
    () => {
      storeApi.setState((state) => ({
        chats: state.chats.map((entry) => (entry.id === chat.id ? previous : entry)),
      }));
    };

  const patchLocal = (update: (current: TopicInfo) => TopicInfo): void => {
    storeApi.setState((state) => ({
      chats: state.chats.map((entry) =>
        entry.id === chat.id && entry.topic !== undefined
          ? { ...entry, topic: update(entry.topic) }
          : entry,
      ),
    }));
  };

  const commit = (
    run: (change: TopicChange) => void,
    input: PatchTopicInput,
    update: (current: TopicInfo) => TopicInfo,
  ): void => {
    const previous = chat;
    patchLocal(update);
    setError('');
    run({ input, rollback: restore(previous) });
  };

  const applyStatus = (next: TopicStatus): void => {
    commit(runStatusSave, { status: next }, (current) => ({ ...current, status: next }));
  };

  const applyOwner = (owner: TopicOwner | null): void => {
    commit(
      runOwnerSave,
      { owner: owner === null ? null : { kind: owner.kind, id: owner.id } },
      (current) => ({
        ...current,
        owner: owner === null ? null : { kind: owner.kind, id: owner.id, name: owner.name },
      }),
    );
  };

  const applyLink = (url: string | null, label: string | null): void => {
    commit(runLinkSave, { linkUrl: url, linkLabel: label }, (current) => ({
      ...current,
      linkUrl: url,
      linkLabel: label,
    }));
  };

  // Open one menu and close the other two.
  const toggleMenu = (menu: 'status' | 'owner' | 'link'): void => {
    setStatusOpen((value) => (menu === 'status' ? !value : false));
    setOwnerOpen((value) => (menu === 'owner' ? !value : false));
    setLinkOpen((value) => (menu === 'link' ? !value : false));
  };

  const toggleLink = (): void => {
    setLinkUrl(topic.linkUrl ?? '');
    setLinkLabel(topic.linkLabel ?? '');
    toggleMenu('link');
  };

  return (
    <div
      aria-label="Topic details"
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-divider bg-panel px-4 py-2"
    >
      <span className="font-mono rounded-[5px] border border-badge-muted px-1.5 text-[10px] leading-[18px] font-semibold tracking-wide text-muted-foreground">
        {typeLabel(chat)}
      </span>

      <StatusMenu
        status={status}
        open={statusOpen}
        onToggle={() => toggleMenu('status')}
        onClose={() => setStatusOpen(false)}
        onChange={applyStatus}
      />

      <OwnerMenu
        owner={topic.owner}
        label={ownerLabel(chat)}
        candidates={candidates}
        open={ownerOpen}
        onToggle={() => toggleMenu('owner')}
        onClose={() => setOwnerOpen(false)}
        onChange={applyOwner}
      />

      <LinkEditor
        href={href}
        text={linkText(chat)}
        open={linkOpen}
        url={linkUrl}
        label={linkLabel}
        onUrlChange={setLinkUrl}
        onLabelChange={setLinkLabel}
        onToggle={toggleLink}
        onClose={() => setLinkOpen(false)}
        onChange={applyLink}
        onError={setError}
      />

      {error !== '' && (
        <span role="alert" className="text-[12px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

export { httpsUrl };
