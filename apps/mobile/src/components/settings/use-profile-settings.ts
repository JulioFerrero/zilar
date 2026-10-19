import { useFocusEffect } from 'expo-router';
import { Data, Effect } from 'effect';
import { useCallback, useRef, useState, useEffect } from 'react';
import { interruptFiber } from '@zilar/client-core';

import { useAuthStore } from '@/auth/session';
import { API_URL } from '@/lib/auth';
import { fetchMe, updateBio } from '@/lib/auth-api';
import { useAction } from '@/lib/effect/use-action';
import { ProfileApiError, type MyProfile, type ProfileApi } from '@/lib/profile-api';
import { getSessionToken } from '@/lib/session-token';
import { mockToken } from '@/mock/gate';

import { createAvatarFileUploader, createPicturePicker } from '@/components/settings/avatar-native';
import {
  friendlyAvatarError,
  friendlyClaimError,
  type AvatarPhase,
  type HandleAvailability,
  handleAvailabilityFor,
  isHandleRateLimited,
} from '@/components/settings/profile-logic';
import { useProfileApi } from '@/components/settings/use-profile-api';

const HANDLE_CHECK_DEBOUNCE_MS = 300;

type HandleCheckOptions = {
  readonly api: ProfileApi;
  readonly trimmed: string;
  readonly ownHandle: boolean;
  readonly setAvailability: (next: HandleAvailability) => void;
};

/**
 * Debounced live availability for a changed handle; a handle change interrupts
 * the fiber. Your own handle (any casing) skips the check: the server would
 * report "taken", which is misleading next to an enabled Save.
 */
function useHandleCheck({ api, trimmed, ownHandle, setAvailability }: HandleCheckOptions) {
  useEffect(() => {
    if (trimmed === '' || ownHandle) {
      return;
    }
    const value = trimmed;
    const check = Effect.sleep(HANDLE_CHECK_DEBOUNCE_MS).pipe(
      Effect.andThen(
        Effect.sync(() => {
          setAvailability({ state: 'checking' });
        }),
      ),
      Effect.andThen(
        Effect.tryPromise({
          try: () => api.checkHandle(value),
          catch: (cause) => cause,
        }),
      ),
      Effect.match({
        onSuccess: (result) =>
          handleAvailabilityFor(value, {
            ok: true,
            available: result.available,
            reason: result.reason,
          }),
        onFailure: (checkError) =>
          handleAvailabilityFor(value, {
            ok: false,
            rateLimited: isHandleRateLimited(checkError),
          }),
      }),
      Effect.andThen((next: HandleAvailability) =>
        Effect.sync(() => {
          setAvailability(next);
        }),
      ),
    );
    const fiber = Effect.runFork(check);
    return () => {
      interruptFiber(fiber);
    };
  }, [api, trimmed, ownHandle, setAvailability]);
}

export type ProfileStatus = 'loading' | 'ready' | 'error';

export class ProfileFailed extends Data.TaggedError('ProfileFailed')<{
  readonly message: string;
}> {}

const NAME_SAVE_ERROR = 'Could not save your name. Try again.';
const BIO_SAVE_ERROR = 'Could not save your bio.';
export const LOAD_ERROR = 'Could not load your profile.';

/**
 * Runs one profile call. A rejection becomes `ProfileFailed` with the fixed
 * sentence `message` gives for it.
 */
function attempt<A>(run: () => Promise<A>, message: (cause: unknown) => string) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new ProfileFailed({ message: message(cause) }),
  });
}

export type ProfileAttempt = typeof attempt;

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

  // A focus reload must not overwrite a field the person edited and did not
  // save; a flag clears when a Save lands for that field.
  const nameDirty = useRef(false);
  const handleDirty = useRef(false);
  const bioDirty = useRef(false);

  // Name, username and bio share one Save (the header action): one busy flag
  // for the fields and one "Saved." confirmation for all three.
  const [saveBusy, setSaveBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const setAvatarUrl = useCallback((url: string | undefined): void => {
    setProfile((previous) => (previous === null ? previous : { ...previous, avatarUrl: url }));
  }, []);

  const avatar = useProfileAvatar(api, attempt, setAvatarUrl);

  // Loads the profile (and the avatar bearer) into every section. It paints
  // `loading` only when nothing is shown yet, so a focus return shows server
  // truth without a flash and keeps unsaved edits; a new load replaces one still
  // running.
  const [, loadProfile] = useAction(
    (_input: void) =>
      Effect.sync(() => {
        setStatus((previous) => (previous === 'ready' ? previous : 'loading'));
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
            if (!nameDirty.current) {
              setNameInput(me.name);
              setNameError(undefined);
            }
            if (!handleDirty.current) {
              setHandle(me.handle ?? '');
              setAvailability({ state: 'idle' });
              setHandleError(undefined);
            }
            if (!bioDirty.current) {
              setBioInput(viewer.bio ?? '');
              setSavedBio(viewer.bio ?? '');
              setBioError(undefined);
            }
            setSaved(false);
            avatar.reset(token);
            setStatus('ready');
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            // A failed background reload keeps the shown profile.
            setStatus((previous) => (previous === 'ready' ? previous : 'error'));
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

  const trimmed = handle.trim();
  const current = profile?.handle ?? '';
  const ownHandle = current !== '' && trimmed.toLowerCase() === current.toLowerCase();
  useHandleCheck({ api, trimmed, ownHandle, setAvailability });

  /**
   * One Save for the whole form, saving the changed fields in the order the calls
   * need: username, then name, then bio (`updateBio` carries the saved name). A
   * failing field keeps its error and stops, so the bio never reverts a rename.
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
                handleDirty.current = false;
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
                nameDirty.current = false;
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
                  bioDirty.current = false;
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
    nameDirty.current = true;
    setNameInput(value);
    setSaved(false);
  };

  const onHandleChange = (value: string): void => {
    handleDirty.current = true;
    setHandle(value);
    setSaved(false);
  };

  const onBioChange = (value: string): void => {
    bioDirty.current = true;
    setBioInput(value);
    setSaved(false);
  };

  // Which fields the one Save would send. A casing-only handle change counts as
  // changed: the server applies it (interval rule, casing updated, nothing
  // retired), the same rule web uses.
  const nameChanged = name.trim() !== (profile?.name ?? '');
  const handleChanged = trimmed !== current;
  const bioChanged = bio.trim() !== savedBio;
  const changed = nameChanged || handleChanged || bioChanged;

  const saveAll = (): void => {
    // Keep the username and name validation: clearing either is a reported error,
    // not a silent no-op.
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

type PickedAvatar = Extract<AvatarPhase, { name: 'picked' }>;

type AvatarOperation =
  | { readonly kind: 'pick' }
  | { readonly kind: 'save'; readonly ownerId: string; readonly picked: PickedAvatar }
  | { readonly kind: 'remove'; readonly ownerId: string };

const PICK_ERROR = 'Could not pick that picture. Try again.';

interface ProfileAvatar {
  readonly token: string | undefined;
  readonly phase: AvatarPhase;
  readonly busy: boolean;
  readonly reset: (token: string | undefined) => void;
  readonly pick: () => void;
  readonly savePicked: (ownerId: string) => void;
  readonly remove: (ownerId: string) => void;
}

function useProfileAvatar(
  api: ProfileApi,
  attempt: ProfileAttempt,
  setAvatarUrl: (url: string | undefined) => void,
): ProfileAvatar {
  const [token, setToken] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<AvatarPhase>({ name: 'idle' });
  const [busy, setBusy] = useState(false);

  // The uploader the settings API calls with the upload url; its failures reach
  // `friendlyAvatarError` unchanged, so the same sentence shows as before.
  const uploaderFor =
    (picked: PickedAvatar) =>
    (url: string): Promise<unknown> => {
      const session: Effect.Effect<string | undefined, unknown> =
        token !== undefined
          ? Effect.succeed(token)
          : Effect.tryPromise({ try: () => getSessionToken(), catch: (cause) => cause });
      return Effect.runPromise(
        session.pipe(
          Effect.flatMap((sessionToken) =>
            sessionToken === undefined
              ? Effect.fail(new ProfileApiError(401, 'unauthorized', 'No session'))
              : Effect.tryPromise({
                  try: () =>
                    createAvatarFileUploader().upload(
                      url,
                      { uri: picked.uri, mimeType: picked.mimeType, width: 0, height: 0 },
                      sessionToken,
                      (fraction) => {
                        setPhase({
                          name: 'uploading',
                          uri: picked.uri,
                          mimeType: picked.mimeType,
                          progress: fraction,
                        });
                      },
                    ),
                  catch: (cause) => cause,
                }),
          ),
        ),
      );
    };

  const avatarEffect = (operation: AvatarOperation): Effect.Effect<void> => {
    switch (operation.kind) {
      case 'pick':
        return attempt(
          () => createPicturePicker().pickPicture(),
          () => PICK_ERROR,
        ).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              if (result.status === 'picked') {
                setPhase({
                  name: 'picked',
                  uri: result.picture.uri,
                  mimeType: result.picture.mimeType,
                });
              } else if (result.status === 'error') {
                setPhase({ name: 'failed', message: result.message });
              }
            }),
          ),
          Effect.catch((failure) =>
            Effect.sync(() => {
              setPhase({ name: 'failed', message: failure.message });
            }),
          ),
        );
      case 'save': {
        const { picked, ownerId } = operation;
        return Effect.sync(() => {
          setPhase({
            name: 'uploading',
            uri: picked.uri,
            mimeType: picked.mimeType,
            progress: 0,
          });
        }).pipe(
          // The settings API uploads a local file through `expo-file-system` (React
          // Native's `fetch` cannot send binary bodies); the uploader reports progress
          // back into the phase. In mock mode the mock answers without touching the file.
          Effect.andThen(
            attempt(
              () =>
                api.uploadAvatar(
                  ownerId,
                  new Blob([], { type: picked.mimeType }),
                  uploaderFor(picked),
                ),
              friendlyAvatarError,
            ),
          ),
          Effect.tap((result) =>
            Effect.sync(() => {
              setAvatarUrl(result.url);
              setPhase({ name: 'idle' });
            }),
          ),
          Effect.catch((failure) =>
            Effect.sync(() => {
              setPhase({ name: 'failed', message: failure.message });
            }),
          ),
        );
      }
      case 'remove':
        return attempt(() => api.removeAvatar(operation.ownerId), friendlyAvatarError).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              setAvatarUrl(undefined);
              setPhase({ name: 'removed' });
            }),
          ),
          Effect.catch((failure) =>
            Effect.sync(() => {
              setPhase({ name: 'failed', message: failure.message });
            }),
          ),
        );
    }
  };

  const [, avatarRun] = useAction(
    (operation: AvatarOperation) =>
      Effect.sync(() => {
        setBusy(true);
      }).pipe(
        Effect.andThen(avatarEffect(operation)),
        Effect.ensuring(
          Effect.sync(() => {
            setBusy(false);
          }),
        ),
      ),
    { mode: 'ignore' },
  );

  const reset = (nextToken: string | undefined): void => {
    setPhase({ name: 'idle' });
    setToken(nextToken);
  };

  const pick = (): void => {
    avatarRun({ kind: 'pick' });
  };

  const savePicked = (ownerId: string): void => {
    if (phase.name !== 'picked') return;
    avatarRun({ kind: 'save', ownerId, picked: phase });
  };

  const remove = (ownerId: string): void => {
    avatarRun({ kind: 'remove', ownerId });
  };

  return { token, phase, busy, reset, pick, savePicked, remove };
}
