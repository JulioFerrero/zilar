import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { checkHandle, claimHandle, getMe, updateMeProfile } from '@/lib/api';
import { useAuth } from '@/auth/AuthProvider';
import { copyText } from '@/lib/clipboard';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { AvatarUploader } from './AvatarUploader';
import { ExportSection } from './ExportSection';
import { useChatSelector } from '@/store/ChatStoreProvider';

type HandleCheck =
  { state: 'idle' } | { state: 'done'; available: boolean; reason?: string | undefined };

const IDLE_CHECK: HandleCheck = { state: 'idle' };

// Debounced live availability for a changed handle: the 300 ms sleep is the
// debounce, and useQuery interrupts it when the handle changes.
const handleCheck = (value: string, ownHandle: boolean): Effect.Effect<HandleCheck> =>
  value === '' || ownHandle
    ? Effect.succeed(IDLE_CHECK)
    : Effect.sleep(300).pipe(
        Effect.andThen(fromApi(() => checkHandle(value))),
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

/** The caller's own picture, inside Settings → Profile. */
function ProfilePictureSection() {
  const auth = useAuth();
  const user = auth.user;
  // The uploader reports the new url (or undefined after a remove) through
  // `onChanged`; while no change happened this render, the session wins.
  const [changedUrl, setChangedUrl] = useState<string | undefined | null>(null);
  // Replace, not ignore: a second change must refresh the session again.
  const [, refetchUser] = useAction<void, void, ApiFailure>(() => fromApi(() => auth.refetch()), {
    mode: 'replace',
  });
  // T-1212: the ball is seeded by the own bare JID (the same ball as the
  // chat list and the contact profile row), the way T-1209 reads it.
  const ownJid = useChatSelector((s) => s.me?.jid);
  if (user === undefined) {
    return null;
  }
  const shown = changedUrl !== null ? changedUrl : user.avatarUrl;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
      <AvatarUploader
        kind="user"
        ownerId={user.id}
        ownerName={user.name}
        ownerSeed={ownJid ?? undefined}
        currentUrl={shown}
        onChanged={(next) => {
          setChangedUrl(next);
          refetchUser();
        }}
      />
    </div>
  );
}

/** Settings → Profile: picture, handle (with live check), bio, share link. */
export function ProfileSettingsSection() {
  const auth = useAuth();
  const [handle, setHandle] = useState(auth.user?.handle ?? '');
  const [typed, setTyped] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  // T-1258: the bio lives on `GET /me`, which `AuthProvider` does not keep, so
  // this section reads it once; the input owns it after that.
  const [bio, setBio] = useState('');
  const [bioTyped, setBioTyped] = useState(false);
  const [remoteBio, setRemoteBio] = useState<string | undefined>(undefined);
  useQuery(
    () =>
      auth.user === undefined
        ? Effect.void
        : fromApi(() => getMe()).pipe(
            Effect.tap((me) => Effect.sync(() => setRemoteBio(me.bio ?? ''))),
            Effect.ignore,
          ),
    [auth.user?.id],
  );

  const trimmed = handle.trim();
  const current = auth.user?.handle ?? '';
  const currentBio = remoteBio ?? '';
  // The live check skips your own handle in any casing: the server sees its
  // live row and would report "taken", which is misleading next to an
  // enabled Save.
  const ownHandle = current !== '' && trimmed.toLowerCase() === current.toLowerCase();

  // Fill the input when the handle arrives after `getMe()` — but only while
  // the user has not started typing, so typed text is never overwritten.
  if (!typed && handle === '' && current !== '') {
    setHandle(current);
  }
  // Same for the bio, which arrives from this section's own `getMe()` read.
  if (!bioTyped && bio === '' && remoteBio !== undefined && remoteBio !== '') {
    setBio(remoteBio);
  }

  const [checkResult] = useQuery(() => handleCheck(trimmed, ownHandle), [trimmed, ownHandle]);
  const check: HandleCheck = AsyncResult.isSuccess(checkResult) ? checkResult.value : IDLE_CHECK;

  const [saveState, runSave] = useAction<
    { handle?: string | undefined; bio?: string | undefined },
    void,
    ApiFailure
  >((input) =>
    Effect.gen(function* () {
      const { handle: nextHandle, bio: nextBio } = input;
      if (nextHandle !== undefined) {
        yield* fromApi(() => claimHandle(nextHandle));
      }
      if (nextBio !== undefined) {
        yield* fromApi(() => updateMeProfile(auth.user?.name ?? '', nextBio));
      }
      yield* fromApi(() => auth.refetch());
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          setSaved(true);
          if (input.handle !== undefined) {
            setHandle(input.handle);
          }
          if (input.bio !== undefined) {
            setRemoteBio(input.bio);
          }
        }),
      ),
      Effect.tapError((failure) => Effect.sync(() => setError(friendlyError(failure)))),
    ),
  );
  const busy = isWaiting(saveState);

  const bioUnchanged = bio.trim() === currentBio;
  const handleChanged = trimmed !== current;

  const save = (): void => {
    if (busy) {
      return;
    }
    // A cleared handle is not a change we apply; an empty handle that was
    // already empty is fine and lets a bio-only save through.
    if (handleChanged && trimmed === '') {
      setError('Choose a username');
      return;
    }
    const nextHandle = handleChanged ? trimmed : undefined;
    const nextBio = bioUnchanged ? undefined : bio.trim();
    if (nextHandle === undefined && nextBio === undefined) {
      return;
    }
    setError(undefined);
    setSaved(false);
    runSave({ handle: nextHandle, bio: nextBio });
  };

  const [, copyShare] = useAction((url: string) =>
    Effect.tryPromise(() => copyText(url)).pipe(
      Effect.tap(() => Effect.sync(() => setCopied(true))),
    ),
  );

  const shareUrl =
    typeof window === 'undefined' || (auth.user?.handle ?? null) === null
      ? null
      : `${window.location.origin}/@${encodeURIComponent(auth.user?.handle ?? '')}`;

  return (
    <section aria-label="Username" className="flex flex-col gap-2">
      <h2 className="text-[16px] font-semibold">Username</h2>
      <ProfilePictureSection />
      <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
        <TextInput
          id="profile-handle"
          label="Your @username"
          value={handle}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={32}
          onChange={(event) => {
            setHandle(event.target.value);
            setTyped(true);
            setSaved(false);
          }}
          placeholder="ada_lovelace"
        />
        <div aria-live="polite" className="mt-1 min-h-[20px] text-[14px]">
          {check.state === 'done' &&
            (check.available ? (
              <span className="text-muted-foreground">@{trimmed} is available</span>
            ) : (
              <span className="text-danger">{reasonText(check.reason)}</span>
            ))}
        </div>
        <div className="mt-3">
          <TextInput
            id="profile-bio"
            label="Bio"
            value={bio}
            maxLength={140}
            onChange={(event) => {
              setBio(event.target.value);
              setBioTyped(true);
              setSaved(false);
            }}
            placeholder="A few words about you"
          />
          <div className="mt-1 flex items-start justify-between gap-2 text-[13px] text-muted-foreground">
            <span>A few words about you. Anyone who finds you by username can see it.</span>
            <span className="shrink-0 tabular-nums">{bio.length} / 140</span>
          </div>
        </div>
        {error !== undefined && (
          <p role="alert" className="mt-1 text-[14px] text-danger">
            {error}
          </p>
        )}
        {saved && <p className="mt-1 text-[14px] text-muted-foreground">Saved.</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => save()}
            disabled={busy || (!handleChanged && bioUnchanged)}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
          {shareUrl !== null && (
            <Button type="button" variant="outline" onClick={() => copyShare(shareUrl)}>
              {copied ? 'Copied' : 'Copy share link'}
            </Button>
          )}
        </div>
      </div>
      <ExportSection />
    </section>
  );
}

function reasonText(reason: string | undefined): string {
  switch (reason) {
    case 'invalid':
      return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
    case 'reserved':
      return 'That username is reserved. Try another.';
    case 'rate_limited':
      return 'Too many checks — wait a little and try again.';
    default:
      return 'That username is taken. Try another.';
  }
}

function friendlyError(error: ApiFailure): string {
  if (error.code === 'unknown_error') {
    return 'Could not save your username. Try again.';
  }
  switch (error.code) {
    case 'handle_invalid':
      return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
    case 'handle_reserved':
      return 'That username is reserved. Try another.';
    case 'handle_taken':
      return 'That username was just taken. Try another.';
    case 'handle_change_too_soon': {
      // The server sends the next-change date as `nextChangeAt` in the
      // 409 error body; the message is only the fallback.
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
