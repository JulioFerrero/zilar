import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { ApiError, checkGroupHandle } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { toApiFailure, type ApiFailure } from '@zilar/client-core';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { FieldError } from './ais/AiPageShell';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TextInput } from './ui/text-input';
import {
  checkHandleAvailability,
  handleReasonText,
  handleSaveError,
  IDLE_AVAILABILITY,
  type HandleAvailability,
} from './settings/handleField';

class StoreFailed extends Data.TaggedError('StoreFailed')<{ readonly message: string }> {}

function fromStore<A>(call: () => Promise<A>): Effect.Effect<A, ApiFailure | StoreFailed> {
  return Effect.tryPromise({
    try: call,
    catch: (cause) =>
      cause instanceof Error && !(cause instanceof ApiError)
        ? new StoreFailed({ message: cause.message })
        : toApiFailure(cause),
  });
}

const visibilityCheck = (
  picked: 'private' | 'public',
  value: string,
  ownHandle: boolean,
): Effect.Effect<HandleAvailability> =>
  picked !== 'public' || ownHandle
    ? Effect.succeed(IDLE_AVAILABILITY)
    : checkHandleAvailability(value, checkGroupHandle);

/**
 * Public groups get an `@handle` in the Explore directory; a handle change is
 * limited to once every 14 days.
 */
export function VisibilitySection({
  chatId,
  groupId,
  visibility,
  handle,
  title,
}: {
  chatId: string;
  groupId: string;
  visibility: 'private' | 'public';
  handle: string | null;
  title: string;
}) {
  const storeApi = useChatStoreApi();
  const [picked, setPicked] = useState<'private' | 'public'>(visibility);
  const [typed, setTyped] = useState(handle ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingPrivate, setConfirmingPrivate] = useState(false);

  // Fill from server truth until the owner types, so a load never clobbers typed text.
  const [seeded, setSeeded] = useState(false);
  if (!seeded) {
    setSeeded(true);
    setPicked(visibility);
    setTyped(handle ?? '');
  }

  const trimmed = typed.trim();
  const unchanged = picked === visibility && (picked === 'private' || trimmed === (handle ?? ''));
  // Skip the group's own handle in any casing: the server would report it as taken.
  const ownHandle =
    handle !== null && handle !== '' && trimmed.toLowerCase() === handle.toLowerCase();

  const [checkResult] = useQuery(
    () => visibilityCheck(picked, trimmed, ownHandle),
    [picked, trimmed, ownHandle],
  );
  const check: HandleAvailability = AsyncResult.isSuccess(checkResult)
    ? checkResult.value
    : IDLE_AVAILABILITY;

  const [saveState, runSave] = useAction<void, void, ApiFailure | StoreFailed>(() =>
    fromStore(() =>
      storeApi.getState().setGroupVisibility(chatId, {
        visibility: picked,
        ...(picked === 'public' ? { handle: trimmed } : {}),
      }),
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          setSaved(true);
          setConfirmingPrivate(false);
        }),
      ),
      Effect.tapError((failure) => Effect.sync(() => setError(friendlyError(failure)))),
    ),
  );
  const busy = isWaiting(saveState);

  const save = (): void => {
    if (picked === 'public' && trimmed === '') {
      setError('Choose a handle for the public group.');
      return;
    }
    if (picked === 'private' && visibility === 'public' && !confirmingPrivate) {
      setConfirmingPrivate(true);
      return;
    }
    if (busy) {
      return;
    }
    setError(undefined);
    setSaved(false);
    runSave();
  };

  const [, copyShare] = useAction((url: string) =>
    Effect.tryPromise(() => copyText(url)).pipe(
      Effect.tap(() => Effect.sync(() => setCopied(true))),
    ),
  );

  const shareUrl =
    typeof window === 'undefined' || handle === null
      ? null
      : `${window.location.origin}/@${encodeURIComponent(handle)}`;

  return (
    <section aria-label="Visibility" className="flex flex-col gap-2 px-2">
      <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Visibility</h2>
      <div className="flex flex-col gap-2 rounded-xl px-2 py-1.5">
        <SegmentedControl
          mode="radio"
          ariaLabel="Visibility"
          options={[
            { value: 'private', label: 'Private' },
            { value: 'public', label: 'Public' },
          ]}
          value={picked}
          onChange={(next) => {
            if (next !== 'private' && next !== 'public') {
              return;
            }
            setPicked(next);
            setError(undefined);
            setSaved(false);
            setConfirmingPrivate(false);
          }}
        />
        {picked === 'public' ? (
          <>
            <p className="text-[13px] text-muted-foreground">
              Anyone can find and join {title === '' ? 'this group' : `“${title}”`}.
            </p>
            <TextInput
              id={`visibility-handle-${groupId}`}
              label="Handle"
              value={typed}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={32}
              onChange={(event) => {
                setTyped(event.target.value);
                setSaved(false);
              }}
              placeholder="hiking_club"
            />
            <div aria-live="polite" className="min-h-[20px] text-[14px]">
              {check.state === 'done' &&
                (check.available ? (
                  <span className="text-muted-foreground">@{trimmed} is available</span>
                ) : (
                  <span className="text-danger">{handleReasonText(check.reason, 'handle')}</span>
                ))}
            </div>
          </>
        ) : (
          visibility === 'public' && (
            <p className="text-[13px] text-muted-foreground">
              Going private removes the group from Explore at once. Members stay members, and the
              old handle stays reserved for this group for 30 days.
            </p>
          )
        )}
        {error !== undefined && <FieldError>{error}</FieldError>}
        {saved && <p className="text-[14px] text-muted-foreground">Saved.</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => save()} disabled={busy || unchanged}>
            {busy ? 'Saving…' : confirmingPrivate ? 'Confirm going private' : 'Save visibility'}
          </Button>
          {confirmingPrivate && (
            <Button type="button" variant="outline" onClick={() => setConfirmingPrivate(false)}>
              Cancel
            </Button>
          )}
          {shareUrl !== null && (
            <Button type="button" variant="outline" onClick={() => copyShare(shareUrl)}>
              {copied ? 'Copied' : 'Copy share link'}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function friendlyError(error: ApiFailure | StoreFailed): string {
  if (error._tag === 'StoreFailed') {
    return error.message;
  }
  if (error.code === 'unknown_error') {
    return 'Could not save the visibility. Try again.';
  }
  return handleSaveError(error, 'handle') ?? error.message;
}
