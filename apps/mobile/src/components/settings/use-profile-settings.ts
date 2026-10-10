import { useFocusEffect } from 'expo-router';
import { Data, Effect, Fiber } from 'effect';
import { useCallback, useEffect, useState } from 'react';

import { useAuthStore } from '@/auth/session';
import { useAction } from '@/lib/effect/use-action';
import { type MyProfile } from '@/lib/profile-api';
import { getSessionToken } from '@/lib/session-token';

import {
  friendlyClaimError,
  handleAvailabilityFor,
  isHandleRateLimited,
  type HandleAvailability,
} from '@/components/settings/profile-logic';
import { useProfileApi } from '@/components/settings/use-profile-api';
import { useProfileAvatar } from '@/components/settings/use-profile-avatar';

export type ProfileStatus = 'loading' | 'ready' | 'error';

/** A failed profile call, carrying the fixed sentence the screen shows. */
export class ProfileFailed extends Data.TaggedError('ProfileFailed')<{
  readonly message: string;
}> {}

const HANDLE_CHECK_DEBOUNCE_MS = 300;
const NAME_SAVE_ERROR = 'Could not save your name. Try again.';
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

/**
 * Owns the profile screen's state: the load, the debounced handle check, and
 * the name and handle saves. The avatar lives in `useProfileAvatar`, its bearer
 * coming back through the load.
 */
export function useProfileSettings() {
  const { api } = useProfileApi();
  const setName = useAuthStore((state) => state.setName);

  const [status, setStatus] = useState<ProfileStatus>('loading');
  const [profile, setProfile] = useState<MyProfile | null>(null);

  const [name, setNameInput] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameBusy, setNameBusy] = useState(false);

  const [handle, setHandle] = useState('');
  const [availability, setAvailability] = useState<HandleAvailability>({ state: 'idle' });
  const [handleError, setHandleError] = useState<string | undefined>(undefined);
  const [handleSaved, setHandleSaved] = useState(false);
  const [handleBusy, setHandleBusy] = useState(false);

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
                () => getSessionToken(),
                () => LOAD_ERROR,
              ),
            ],
            { concurrency: 'unbounded' },
          ),
        ),
        Effect.tap(([me, token]) =>
          Effect.sync(() => {
            setProfile(me);
            setNameInput(me.name);
            setNameError(undefined);
            setNameSaved(false);
            setHandle(me.handle ?? '');
            setAvailability({ state: 'idle' });
            setHandleError(undefined);
            setHandleSaved(false);
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

  // Debounced live availability for a changed handle. A forked fiber waits
  // the debounce, then applies the result; a handle change interrupts it. Your
  // own handle (any casing) skips the check: the server sees its live row
  // and would report "taken", which is misleading next to an enabled Save.
  const trimmed = handle.trim();
  const current = profile?.handle ?? '';
  const ownHandle = current !== '' && trimmed.toLowerCase() === current.toLowerCase();
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
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [api, trimmed, ownHandle]);

  const [, saveNameRun] = useAction(
    (value: string) =>
      Effect.sync(() => {
        setNameBusy(true);
        setNameError(undefined);
        setNameSaved(false);
      }).pipe(
        Effect.andThen(
          attempt(
            () => setName(value),
            () => NAME_SAVE_ERROR,
          ),
        ),
        Effect.flatMap((result) =>
          result.ok ? Effect.void : Effect.fail(new ProfileFailed({ message: NAME_SAVE_ERROR })),
        ),
        Effect.tap(() =>
          Effect.sync(() => {
            setProfile((previous) => (previous === null ? previous : { ...previous, name: value }));
            setNameSaved(true);
          }),
        ),
        Effect.catch((failure) =>
          Effect.sync(() => {
            setNameError(failure.message);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            setNameBusy(false);
          }),
        ),
      ),
    { mode: 'ignore' },
  );

  const [, claimHandleRun] = useAction(
    (value: string) =>
      Effect.sync(() => {
        setHandleBusy(true);
        setHandleError(undefined);
        setHandleSaved(false);
      }).pipe(
        Effect.andThen(attempt(() => api.claimHandle(value), friendlyClaimError)),
        Effect.tap((claimed) =>
          Effect.sync(() => {
            setProfile((previous) =>
              previous === null ? previous : { ...previous, handle: claimed.handle },
            );
            setHandle(claimed.handle);
            setAvailability({ state: 'idle' });
            setHandleSaved(true);
          }),
        ),
        Effect.catch((failure) =>
          Effect.sync(() => {
            setHandleError(failure.message);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            setHandleBusy(false);
          }),
        ),
      ),
    { mode: 'ignore' },
  );

  const onNameChange = (value: string): void => {
    setNameInput(value);
    setNameSaved(false);
  };

  const onHandleChange = (value: string): void => {
    setHandle(value);
    setHandleSaved(false);
  };

  const saveName = (): void => {
    const value = name.trim();
    if (value.length === 0) {
      setNameError('Enter your name');
      return;
    }
    saveNameRun(value);
  };

  const saveHandle = (): void => {
    if (trimmed === '') {
      setHandleError('Choose a username');
      return;
    }
    claimHandleRun(trimmed);
  };

  // Save is disabled only for the exactly equal value; a casing-only change
  // stays enabled — the server applies it (interval rule, casing updated,
  // nothing retired).
  const unchanged = trimmed !== '' && trimmed === current;
  const nameUnchanged = name.trim() !== '' && name.trim() === (profile?.name ?? '');

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
    nameSaved,
    nameBusy,
    nameUnchanged,
    onNameChange,
    saveName,
    handle,
    currentHandle: current,
    availability,
    handleError,
    handleSaved,
    handleBusy,
    handleSaveDisabled: unchanged,
    onHandleChange,
    saveHandle,
  };
}
