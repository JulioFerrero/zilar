import {
  checkHandleAvailability,
  handleReasonText,
  handleSaveError,
  IDLE_AVAILABILITY,
  type HandleAvailability,
} from './settings/handleField';
import { AvatarUploader } from './AvatarUploader';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { checkHandle, claimHandle, getMe, updateMe, updateMeProfile, fetchExport } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { fromApi, type ApiFailure, isWaiting, failureOf } from '@zilar/client-core';
import { Effect, Data } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Download } from 'lucide-react';
import { useState } from 'react';

const handleCheck = (value: string, ownHandle: boolean): Effect.Effect<HandleAvailability> =>
  value === '' || ownHandle
    ? Effect.succeed(IDLE_AVAILABILITY)
    : checkHandleAvailability(value, checkHandle);

function ProfilePictureSection() {
  const auth = useAuth();
  const user = auth.user;
  const [changedUrl, setChangedUrl] = useState<string | undefined | null>(null);
  const [, refetchUser] = useAction<void, void, ApiFailure>(() => fromApi(() => auth.refetch()), {
    mode: 'replace',
  });
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
        currentUrl={shown}
        onChanged={(next) => {
          setChangedUrl(next);
          refetchUser();
        }}
      />
    </div>
  );
}

const FALLBACK_FILENAME = 'zilar-export.json';

// Fixed sentences for a stale session, the hourly cap and the 200 000-message cap.
type ExportReason = 'reauth' | 'rate' | 'too_large' | 'failed';

const EXPORT_MESSAGES: Record<ExportReason, string> = {
  reauth:
    'For your safety, sign in again to export. Exports need a sign-in from the last 30 minutes.',
  rate: 'You can export once an hour. Try again later.',
  too_large: 'Your history is too large to export here. Contact the operator.',
  failed: 'Could not export. Try again.',
};

class ExportFailure extends Data.TaggedError('ExportFailure')<{
  readonly reason: ExportReason;
}> {}

function reasonForStatus(status: number): ExportReason {
  switch (status) {
    case 403:
      return 'reauth';
    case 429:
      return 'rate';
    case 413:
      return 'too_large';
    default:
      return 'failed';
  }
}

// The filename is stripped of any path, so the saved file never leaves the download folder.
function filenameFrom(header: string | null): string {
  const match = header === null ? null : /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  const name = match?.[1]?.trim().split(/[\\/]/).pop();
  return name === undefined || name === '' ? FALLBACK_FILENAME : name;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const exportEffect = (): Effect.Effect<void, ExportFailure> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetchExport(),
      catch: () => new ExportFailure({ reason: 'failed' }),
    });
    if (!response.ok) {
      return yield* Effect.fail(new ExportFailure({ reason: reasonForStatus(response.status) }));
    }
    const blob = yield* Effect.tryPromise({
      try: () => response.blob(),
      catch: () => new ExportFailure({ reason: 'failed' }),
    });
    yield* Effect.sync(() => {
      saveBlob(blob, filenameFrom(response.headers.get('Content-Disposition')));
    });
  });

function ExportSection() {
  const [state, runExport] = useAction<void, void, ExportFailure>(exportEffect);
  const busy = isWaiting(state);
  const failure = busy ? undefined : failureOf(state);

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-[16px] font-semibold">Export your data</h2>
      <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
        <p className="text-[14px] text-muted-foreground">
          Download your profile, contacts and messages as a JSON file.
        </p>
        <div className="mt-2">
          <Button type="button" onClick={() => runExport()} disabled={busy}>
            <Download />
            {busy ? 'Preparing…' : 'Export my messages'}
          </Button>
        </div>
        {AsyncResult.isSuccess(state) && (
          <p role="status" className="mt-1 text-[14px] text-muted-foreground">
            Export downloaded.
          </p>
        )}
        {failure !== undefined && (
          <p role="alert" className="mt-1 text-[14px] text-danger">
            {EXPORT_MESSAGES[failure.reason]}
          </p>
        )}
      </div>
    </div>
  );
}

export function ProfileSettingsSection() {
  const auth = useAuth();
  const storeApi = useChatStoreApi();
  const [handle, setHandle] = useState(auth.user?.handle ?? '');
  const [typed, setTyped] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bio, setBio] = useState('');
  const [bioTyped, setBioTyped] = useState(false);
  const [remoteBio, setRemoteBio] = useState<string | undefined>(undefined);
  const [name, setName] = useState(auth.user?.name ?? '');
  const [nameTyped, setNameTyped] = useState(false);
  const [remoteName, setRemoteName] = useState<string | undefined>(undefined);
  useQuery(
    () =>
      auth.user === undefined
        ? Effect.void
        : fromApi(() => getMe()).pipe(
            Effect.tap((me) =>
              Effect.sync(() => {
                setRemoteBio(me.bio ?? '');
                setRemoteName(me.name);
              }),
            ),
            Effect.ignore,
          ),
    [auth.user?.id],
  );

  const trimmed = handle.trim();
  const current = auth.user?.handle ?? '';
  const currentBio = remoteBio ?? '';
  const currentName = remoteName ?? auth.user?.name ?? '';
  const trimmedName = name.trim();
  // Skip your own handle in any casing: the server would report it as taken.
  const ownHandle = current !== '' && trimmed.toLowerCase() === current.toLowerCase();

  if (!typed && handle === '' && current !== '') {
    setHandle(current);
  }
  if (!bioTyped && bio === '' && remoteBio !== undefined && remoteBio !== '') {
    setBio(remoteBio);
  }
  if (!nameTyped && remoteName !== undefined && name !== remoteName) {
    setName(remoteName);
  }

  const [checkResult] = useQuery(() => handleCheck(trimmed, ownHandle), [trimmed, ownHandle]);
  const check: HandleAvailability = AsyncResult.isSuccess(checkResult)
    ? checkResult.value
    : IDLE_AVAILABILITY;

  const [saveState, runSave] = useAction<
    { handle?: string | undefined; name?: string | undefined; bio?: string | undefined },
    void,
    ApiFailure
  >((input) =>
    Effect.gen(function* () {
      const { handle: nextHandle, name: nextName, bio: nextBio } = input;
      if (nextHandle !== undefined) {
        yield* fromApi(() => claimHandle(nextHandle));
      }
      if (nextName !== undefined) {
        yield* fromApi(() => updateMe(nextName));
      }
      if (nextBio !== undefined) {
        // `PATCH /me` requires the name, so a bio-only save resends the current one.
        yield* fromApi(() => updateMeProfile(nextName ?? currentName, nextBio));
      }
      yield* fromApi(() => auth.refetch());
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          setSaved(true);
          if (input.handle !== undefined) {
            setHandle(input.handle);
          }
          if (input.name !== undefined) {
            const savedName = input.name;
            setName(savedName);
            setRemoteName(savedName);
            storeApi.setState((state) =>
              state.me === undefined ? state : { me: { ...state.me, name: savedName } },
            );
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
  const nameChanged = trimmedName !== currentName;

  const save = (): void => {
    if (busy) {
      return;
    }
    // A cleared handle is not applied; one that was already empty still allows a save.
    if (handleChanged && trimmed === '') {
      setError('Choose a username');
      return;
    }
    // The display name must stay 1–64 characters (the server's rule).
    if (nameChanged && trimmedName === '') {
      setError('Enter your name');
      return;
    }
    const nextHandle = handleChanged ? trimmed : undefined;
    const nextName = nameChanged ? trimmedName : undefined;
    const nextBio = bioUnchanged ? undefined : bio.trim();
    if (nextHandle === undefined && nextName === undefined && nextBio === undefined) {
      return;
    }
    setError(undefined);
    setSaved(false);
    runSave({ handle: nextHandle, name: nextName, bio: nextBio });
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
    <section aria-label="Profile" className="flex flex-col gap-2">
      <ProfilePictureSection />
      <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
        <TextInput
          id="profile-name"
          label="Name"
          value={name}
          maxLength={64}
          onChange={(event) => {
            setName(event.target.value);
            setNameTyped(true);
            setSaved(false);
          }}
          placeholder="Your name"
        />
        <div className="mt-3">
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
                <span className="text-danger">{handleReasonText(check.reason, 'username')}</span>
              ))}
          </div>
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
            disabled={busy || (!handleChanged && !nameChanged && bioUnchanged)}
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

function friendlyError(error: ApiFailure): string {
  if (error.code === 'unknown_error') {
    return 'Could not save your changes. Try again.';
  }
  return handleSaveError(error, 'username') ?? error.message;
}
