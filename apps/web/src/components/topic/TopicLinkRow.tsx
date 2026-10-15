import type { ChatSummary } from '@zilar/chat-core';
import { Effect, Option, Schema } from 'effect';
import { Link, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ListRow } from '@/components/ui/list-row';
import { TextInput } from '@/components/ui/text-input';
import { fromApi } from '@/lib/effect/api-effect';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStoreApi } from '@/store/ChatStoreProvider';

const LABEL_MAX = 40;
const SAVE_FAILED = 'Could not save. Try again.';
const INVALID_URL = 'Link must be an https URL.';

/** Only `https:` URLs save and open as links; anything else is rejected. */
function httpsUrl(url: string | null | undefined): string | undefined {
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

/** The row's title: the label when set, else the link's host. */
function linkTitle(label: string | null, href: string): string {
  if (label !== null && label !== '') {
    return label;
  }
  return new URL(href).hostname;
}

/**
 * The topic's link (T-1534): an editable row in the topic info panel. The
 * label (or the host) opens the URL in a new tab, the pencil edits it, and
 * the form keeps the https check and the 40-character label. Without a link
 * the row adds one, and an existing one can be removed.
 */
export function TopicLinkRow({
  chat,
  onError,
}: {
  chat: ChatSummary;
  onError: (message: string) => void;
}) {
  const storeApi = useChatStoreApi();
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [savingState, runSave] = useAction<
    { linkUrl: string | null; linkLabel: string | null },
    void,
    never
  >((input) =>
    fromApi(() => storeApi.getState().patchTopic(chat.id, input)).pipe(
      Effect.tap(() => Effect.sync(() => setEditing(false))),
      Effect.catchTag('ApiFailure', () =>
        Effect.sync(() => {
          onError(SAVE_FAILED);
        }),
      ),
    ),
  );
  const saving = isWaiting(savingState);

  const topic = chat.topic;
  if (topic === undefined) {
    return null;
  }
  const href = httpsUrl(topic.linkUrl);

  const startEdit = (): void => {
    onError('');
    setUrl(topic.linkUrl ?? '');
    setLabel(topic.linkLabel ?? '');
    setEditing(true);
  };

  const save = (): void => {
    onError('');
    const trimmed = url.trim();
    if (trimmed !== '' && httpsUrl(trimmed) === undefined) {
      onError(INVALID_URL);
      return;
    }
    const nextUrl = trimmed === '' ? null : trimmed;
    const nextLabel = label.trim() === '' ? null : label.trim().slice(0, LABEL_MAX);
    runSave({ linkUrl: nextUrl, linkLabel: nextLabel });
  };

  const remove = (): void => {
    onError('');
    runSave({ linkUrl: null, linkLabel: null });
  };

  if (!editing) {
    if (href === undefined) {
      return (
        <ListRow
          icon={<Link className="size-4" aria-hidden="true" />}
          title="Add a link"
          onClick={startEdit}
        />
      );
    }
    return (
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <ListRow
            icon={<Link className="size-4" aria-hidden="true" />}
            title={linkTitle(topic.linkLabel, href)}
            onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}
          />
        </div>
        <IconButton
          size={32}
          aria-label="Edit topic link"
          className="mr-1 text-muted-foreground"
          onClick={startEdit}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
    );
  }

  return (
    <div className="mx-2 flex flex-col gap-2 rounded-xl border border-border p-3">
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium">URL (https only)</span>
        <TextInput
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://…"
          inputMode="url"
          className="rounded-[8px] px-2.5 py-1.5 text-[13px]"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium">Label (optional)</span>
        <TextInput
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={LABEL_MAX}
          placeholder="PR #42"
          className="rounded-[8px] px-2.5 py-1.5 text-[13px]"
        />
      </label>
      <div className="flex justify-end gap-1.5">
        {href !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mr-auto text-danger"
            disabled={saving}
            onClick={remove}
          >
            Remove
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
        <Button type="button" variant="default" size="sm" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
