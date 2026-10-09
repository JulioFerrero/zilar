import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { ApiError, checkGroupHandle } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { fromApi } from '@/lib/effect/api-effect';
import { toApiFailure, type ApiFailure } from '@/lib/effect/errors';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { FieldError } from './ais/AiPageShell';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TextInput } from './ui/text-input';

/** A chat-store call rejected with a plain Error: the sentence is the store's own. */
class StoreFailed extends Data.TaggedError('StoreFailed')<{ readonly message: string }> {}

/**
 * Lifts a chat-store call. An ApiError keeps its code (as in api.ts), a plain
 * Error keeps its message, and any other value becomes the generic failure.
 */
function fromStore<A>(call: () => Promise<A>): Effect.Effect<A, ApiFailure | StoreFailed> {
  return Effect.tryPromise({
    try: call,
    catch: (cause) =>
      cause instanceof Error && !(cause instanceof ApiError)
        ? new StoreFailed({ message: cause.message })
        : toApiFailure(cause),
  });
}

type HandleCheck =
  { state: 'idle' } | { state: 'done'; available: boolean; reason?: string | undefined };

const IDLE_CHECK: HandleCheck = { state: 'idle' };

// Debounced live availability for a public handle: the 300 ms sleep is the
// debounce, and useQuery interrupts it when the handle or visibility changes.
const visibilityCheck = (
  picked: 'private' | 'public',
  value: string,
  ownHandle: boolean,
): Effect.Effect<HandleCheck> =>
  picked !== 'public' || value === '' || ownHandle
    ? Effect.succeed(IDLE_CHECK)
    : Effect.sleep(300).pipe(
        Effect.andThen(fromApi(() => checkGroupHandle(value))),
        Effect.map((result): HandleCheck => ({
          state: 'done',
          available: result.available,
          reason: result.reason,
        })),
        Effect.catchTag('ApiFailure', (failure) =>
          Effect.succeed(
            failure.code === 'rate_limited'
              ? ({ state: 'done', available: false, reason: 'rate_limited' } as const)
              : IDLE_CHECK,
          ),
        ),
      );

/**
 * Visibility settings (T-0164, owner only): flip a group or channel private
 * (invite-only, like before) or public (its own `@handle`, in the Explore
 * directory, joinable with one tap). Public asks for a handle with the live
 * availability check; going private explains that the group disappears from
 * the directory at once while members stay. The handle shows the "next
 * change possible on" message when the 14-day interval refuses, and a copy
 * button for the share link `<origin>/@handle`.
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

  // Fill from server truth until the owner starts typing, so a change made
  // elsewhere (or the first load) paints without clobbering typed text.
  const [seeded, setSeeded] = useState(false);
  if (!seeded) {
    setSeeded(true);
    setPicked(visibility);
    setTyped(handle ?? '');
  }

  const trimmed = typed.trim();
  const unchanged = picked === visibility && (picked === 'private' || trimmed === (handle ?? ''));
  // The live check skips the group's own handle in any casing: the server
  // sees its live row and would report "taken", which is misleading next
  // to a Save the interval rule still guards.
  const ownHandle =
    handle !== null && handle !== '' && trimmed.toLowerCase() === handle.toLowerCase();

  const [checkResult] = useQuery(
    () => visibilityCheck(picked, trimmed, ownHandle),
    [picked, trimmed, ownHandle],
  );
  const check: HandleCheck = AsyncResult.isSuccess(checkResult) ? checkResult.value : IDLE_CHECK;

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
                  <span className="text-danger">{reasonText(check.reason)}</span>
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

function reasonText(reason: string | undefined): string {
  switch (reason) {
    case 'invalid':
      return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
    case 'reserved':
      return 'That handle is reserved. Try another.';
    case 'rate_limited':
      return 'Too many checks — wait a little and try again.';
    default:
      return 'That handle is taken. Try another.';
  }
}

function friendlyError(error: ApiFailure | StoreFailed): string {
  if (error._tag === 'StoreFailed') {
    return error.message;
  }
  if (error.code === 'unknown_error') {
    return 'Could not save the visibility. Try again.';
  }
  switch (error.code) {
    case 'handle_invalid':
      return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
    case 'handle_reserved':
      return 'That handle is reserved. Try another.';
    case 'handle_taken':
      return 'That handle was just taken. Try another.';
    case 'handle_change_too_soon': {
      const next = error.detail.nextChangeAt;
      if (typeof next === 'string' && next !== '') {
        const date = new Date(next);
        if (!Number.isNaN(date.getTime())) {
          return `Next change possible on ${date.toLocaleDateString()}`;
        }
      }
      return error.message;
    }
    case 'rate_limited':
      return 'Too many tries — wait a little and try again.';
    default:
      return error.message;
  }
}
