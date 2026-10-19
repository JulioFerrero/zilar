import { httpsTopicUrl, type ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { Link, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ListRow } from '@/components/ui/list-row';
import { TextInput } from '@/components/ui/text-input';
import { fromApi, isWaiting } from '@zilar/client-core';
import { useAction } from '@/lib/effect/use-action';
import { useChatStoreApi } from '@/store/ChatStoreProvider';

const LABEL_MAX = 40;
const SAVE_FAILED = 'Could not save. Try again.';
const INVALID_URL = 'Link must be an https URL.';

function linkTitle(label: string | null, href: string): string {
  if (label !== null && label !== '') {
    return label;
  }
  return new URL(href).hostname;
}

/**
 * chat-core's parser keeps the phone working without a full `URL`, and a value
 * it accepts but `new URL` refuses (a link stored by an older release) shows
 * "Add a link" instead of crashing the panel.
 */
function browserHttpsUrl(url: string | null | undefined): string | undefined {
  const href = httpsTopicUrl(url);
  if (href === undefined) {
    return undefined;
  }
  try {
    new URL(href);
    return href;
  } catch {
    return undefined;
  }
}

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
  const href = browserHttpsUrl(topic.linkUrl);

  const startEdit = (): void => {
    onError('');
    setUrl(topic.linkUrl ?? '');
    setLabel(topic.linkLabel ?? '');
    setEditing(true);
  };

  const save = (): void => {
    onError('');
    const trimmed = url.trim();
    if (trimmed !== '' && browserHttpsUrl(trimmed) === undefined) {
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
