import { useFocusEffect } from 'expo-router';
import { Data, Effect } from 'effect';
import { useCallback, useState } from 'react';

import { useAuthStore } from '@/auth/session';
import { API_URL } from '@/lib/auth';
import { fetchMe, updateBio } from '@/lib/auth-api';
import { useAction } from '@/lib/effect/use-action';
import { type MyProfile } from '@/lib/profile-api';
import { getSessionToken } from '@/lib/session-token';
import { mockToken } from '@/mock/gate';

import { friendlyClaimError, type HandleAvailability } from '@/components/settings/profile-logic';
import { useHandleCheck } from '@/components/settings/use-handle-check';
import { useProfileApi } from '@/components/settings/use-profile-api';
import { useProfileAvatar } from '@/components/settings/use-profile-avatar';

export type ProfileStatus = 'loading' | 'ready' | 'error';

/** A failed profile call, carrying the fixed sentence the screen shows. */
export class ProfileFailed extends Data.TaggedError('ProfileFailed')<{
  readonly message: string;
}> {}

const NAME_SAVE_ERROR = 'Could not save your name. Try again.';
const BIO_SAVE_ERROR = 'Could not save your bio.';
export const LOAD_ERROR = 'Could not load your profile.';

/**
 * Runs one profile call. A rejection becomes `ProfileFailed` with the message
 * `message` gives for it, so the screen shows a fixed sentence.
 */
function attempt<A>(run: () => Promise<A>, message: (cause: unknown) => string) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new ProfileFailed({ message: message(cause) }),
  });
}

/** The shape of the shared call wrapper, handed to `useProfileAvatar`. */
export type ProfileAttempt = typeof attempt;

/** What the one Save carries: the trimmed values plus which fields changed. */
type SaveInput = {
  readonly handle: string;
  readonly name: string;
  readonly bio: string;
  readonly handleChanged: boolean;
  readonly nameChanged: boolean;
  readonly bioChanged: boolean;
};

/** The bio calls' fetch: `mockFetch` in mock mode, else the real one (T-1259). */
function bioFetch(mock: boolean): typeof fetch {
  if (mock && (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mockFetch } = require('@/mock/backend') as typeof import('@/mock/backend');
    return mockFetch;
  }
  return fetch;
}

/**
 * Owns the profile screen's state: the load, the debounced handle check, and
 * the name and handle saves. The avatar lives in `useProfileAvatar`, its bearer
 * coming back through the load.
 */
export function useProfileSettings() {
  const { api, mock } = useProfileApi();
  const setName = useAuthStore((state) => state.setName);

  const [status, setStatus] = useState<ProfileStatus>('loading');
  const [profile, setProfile] = useState<MyProfile | null>(null);

  const [name, setNameInput] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);

  const [handle, setHandle] = useState('');
  const [availability, setAvailability] = useState<HandleAvailability>({ state: 'idle' });
  const [handleError, setHandleError] = useState<string | undefined>(undefined);

  const [bio, setBioInput] = useState('');
  const [savedBio, setSavedBio] = useState('');
  const [bioError, setBioError] = useState<string | undefined>(undefined);

  // T-1329: name, username and bio share one Save (the header action): one
  // busy flag for the fields and one "Saved." confirmation for all three.
  const [saveBusy, setSaveBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const setAvatarUrl = useCallback((url: string | undefined): void => {
    setProfile((previous) => (previous === null ? previous : { ...previous, avatarUrl: url }));
  }, []);

  const avatar = useProfileAvatar(api, attempt, setAvatarUrl);

  // Loads the profile (and the avatar bearer) into every section. It paints
  // `loading` first; the focus effect below runs it, so returning to the
  // screen always shows server truth. A new load replaces one still running.
  const [, loadProfile] = useAction(
    (_input: void) =>
      Effect.sync(() => {
        setStatus('loading');
      }).pipe(
        Effect.andThen(
          Effect.all(
            [
              attempt(
                () => api.getMe(),
                () => LOAD_ERROR,
              ),
              attempt(
                () => (mock ? mockToken : getSessionToken)(),
                () => LOAD_ERROR,
              ),
            ],
            { concurrency: 'unbounded' },
          ),
        ),
        // T-1259: `MyProfile` drops the bio, so read it through `fetchMe`.
        Effect.flatMap(([me, token]) =>
          token === undefined
            ? Effect.fail(new ProfileFailed({ message: LOAD_ERROR }))
            : attempt(
                () => fetchMe(API_URL, token, bioFetch(mock)),
                () => LOAD_ERROR,
              ).pipe(Effect.map((viewer) => ({ me, token, viewer }))),
        ),
        Effect.tap(({ me, token, viewer }) =>
          Effect.sync(() => {
            setProfile(me);
            setNameInput(me.name);
            setNameError(undefined);
            setHandle(me.handle ?? '');
            setAvailability({ state: 'idle' });
            setHandleError(undefined);
            setBioInput(viewer.bio ?? '');
            setSavedBio(viewer.bio ?? '');
            setBioError(undefined);
            setSaved(false);
            avatar.reset(token);
            setStatus('ready');
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            setStatus('error');
          }),
        ),
      ),
    { mode: 'replace' },
  );

  const load = useCallback(() => {
    loadProfile();
  }, [loadProfile]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const reload = load;

  // The trimmed handle and the two flags the debounced check and the Save share.
  const trimmed = handle.trim();
  const current = profile?.handle ?? '';
  const ownHandle = current !== '' && trimmed.toLowerCase() === current.toLowerCase();
  useHandleCheck({ api, trimmed, ownHandle, setAvailability });

  /**
   * T-1329: one Save for the whole form, the mobile twin of web's `save()`.
   * It saves the fields that changed, in an order the calls need: the username
   * (`api.claimHandle`), then the name (`setName` → `PATCH /me`), then the bio
   * (`updateBio`, which carries the freshly saved name). A failing field keeps
   * its own error line and stops the run, so the bio never reverts a rename
   * that did not land (the old name/bio guard, now implicit in the sequence).
   */
  const [, saveRun] = useAction(
    (input: SaveInput) =>
      Effect.sync(() => {
        setSaveBusy(true);
        setSaved(false);
        setNameError(undefined);
        setHandleError(undefined);
        setBioError(undefined);
      }).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            let savedName = profile?.name ?? input.name;
            if (input.handleChanged) {
              const claimed = yield* attempt(
                () => api.claimHandle(input.handle),
                friendlyClaimError,
              ).pipe(
                Effect.tapError((failure) =>
                  Effect.sync(() => {
                    setHandleError(failure.message);
                  }),
                ),
              );
              yield* Effect.sync(() => {
                setProfile((previous) =>
                  previous === null ? previous : { ...previous, handle: claimed.handle },
                );
                setHandle(claimed.handle);
                setAvailability({ state: 'idle' });
              });
            }
            if (input.nameChanged) {
              const result = yield* attempt(
                () => setName(input.name),
                () => NAME_SAVE_ERROR,
              );
              if (!result.ok) {
                yield* Effect.sync(() => {
                  setNameError(NAME_SAVE_ERROR);
                });
                yield* Effect.fail(new ProfileFailed({ message: NAME_SAVE_ERROR }));
              }
              savedName = input.name;
              yield* Effect.sync(() => {
                setProfile((previous) =>
                  previous === null ? previous : { ...previous, name: input.name },
                );
              });
            }
            if (input.bioChanged) {
              const token = avatar.token;
              if (token === undefined) {
                yield* Effect.sync(() => {
                  setBioError(BIO_SAVE_ERROR);
                });
                yield* Effect.fail(new ProfileFailed({ message: BIO_SAVE_ERROR }));
              } else {
                yield* attempt(
                  () => updateBio(API_URL, token, savedName, input.bio, bioFetch(mock)),
                  () => BIO_SAVE_ERROR,
                ).pipe(
                  Effect.tapError((failure) =>
                    Effect.sync(() => {
                      setBioError(failure.message);
                    }),
                  ),
                );
                yield* Effect.sync(() => {
                  setSavedBio(input.bio);
                  setBioInput(input.bio);
                });
              }
            }
          }),
        ),
        Effect.tap(() =>
          Effect.sync(() => {
            setSaved(true);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            setSaveBusy(false);
          }),
        ),
      ),
    { mode: 'ignore' },
  );

  const onNameChange = (value: string): void => {
    setNameInput(value);
    setSaved(false);
  };

  const onHandleChange = (value: string): void => {
    setHandle(value);
    setSaved(false);
  };

  const onBioChange = (value: string): void => {
    setBioInput(value);
    setSaved(false);
  };

  // Which fields the one Save would send. A casing-only handle change counts
  // as changed: the server applies it (interval rule, casing updated, nothing
  // retired), the same rule web uses.
  const nameChanged = name.trim() !== (profile?.name ?? '');
  const handleChanged = trimmed !== current;
  const bioChanged = bio.trim() !== savedBio;
  const changed = nameChanged || handleChanged || bioChanged;

  const saveAll = (): void => {
    // Keep the username and name validation: clearing either is a reported
    // error, not a silent no-op.
    if (handleChanged && trimmed === '') {
      setHandleError('Choose a username');
      return;
    }
    if (nameChanged && name.trim() === '') {
      setNameError('Enter your name');
      return;
    }
    if (!changed) {
      return;
    }
    saveRun({
      handle: trimmed,
      name: name.trim(),
      bio: bio.trim(),
      handleChanged,
      nameChanged,
      bioChanged,
    });
  };

  return {
    status,
    profile,
    reload,
    avatarToken: avatar.token,
    avatarPhase: avatar.phase,
    avatarBusy: avatar.busy,
    pickPicture: avatar.pick,
    savePickedPicture: avatar.savePicked,
    removePicture: avatar.remove,
    name,
    nameError,
    onNameChange,
    bio,
    bioError,
    onBioChange,
    handle,
    availability,
    handleError,
    onHandleChange,
    changed,
    saved,
    saveBusy,
    saveAll,
  };
}
