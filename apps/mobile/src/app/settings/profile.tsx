import { useFocusEffect, useRouter } from 'expo-router';
import { Data, Effect, Fiber } from 'effect';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { useAuthStore } from '@/auth/session';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { getSessionToken } from '@/lib/session-token';
import { useAction } from '@/lib/effect/use-action';
import { ProfileApiError, type MyProfile } from '@/lib/profile-api';

import { AvatarControl } from '@/components/settings/avatar-control';
import { createAvatarFileUploader, createPicturePicker } from '@/components/settings/avatar-native';
import { HandleField } from '@/components/settings/handle-field';
import {
  friendlyAvatarError,
  friendlyClaimError,
  handleAvailabilityFor,
  isHandleRateLimited,
  type AvatarPhase,
  type HandleAvailability,
} from '@/components/settings/profile-logic';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { useProfileApi } from '@/components/settings/use-profile-api';

type ProfileStatus = 'loading' | 'ready' | 'error';

type PickedAvatar = Extract<AvatarPhase, { name: 'picked' }>;

/** One avatar action; the picker, the save and the removal share one slot. */
type AvatarOperation =
  | { readonly kind: 'pick' }
  | { readonly kind: 'save'; readonly ownerId: string; readonly picked: PickedAvatar }
  | { readonly kind: 'remove'; readonly ownerId: string };

/** A failed profile call, carrying the fixed sentence the screen shows. */
class ProfileFailed extends Data.TaggedError('ProfileFailed')<{ readonly message: string }> {}

const HANDLE_CHECK_DEBOUNCE_MS = 300;
const NAME_SAVE_ERROR = 'Could not save your name. Try again.';
const PICK_ERROR = 'Could not pick that picture. Try again.';
const LOAD_ERROR = 'Could not load your profile.';

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

export default function ProfileSettingsScreen() {
  return (
    <RequireAuth>
      <ProfileSettings />
    </RequireAuth>
  );
}

function ProfileSettings() {
  const router = useRouter();
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

  const [avatarToken, setAvatarToken] = useState<string | undefined>(undefined);
  const [avatarPhase, setAvatarPhase] = useState<AvatarPhase>({ name: 'idle' });
  const [avatarBusy, setAvatarBusy] = useState(false);

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
            setAvatarPhase({ name: 'idle' });
            setAvatarToken(token);
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

  // The avatar uploader the settings API calls with the upload url. Its
  // failures reach `friendlyAvatarError` unchanged (runPromise rejects with
  // the error value), so the same sentence shows as before.
  const uploaderFor =
    (picked: PickedAvatar) =>
    (url: string): Promise<unknown> => {
      const session: Effect.Effect<string | undefined, unknown> =
        avatarToken !== undefined
          ? Effect.succeed(avatarToken)
          : Effect.tryPromise({ try: () => getSessionToken(), catch: (cause) => cause });
      return Effect.runPromise(
        session.pipe(
          Effect.flatMap((token) =>
            token === undefined
              ? Effect.fail(new ProfileApiError(401, 'unauthorized', 'No session'))
              : Effect.tryPromise({
                  try: () =>
                    createAvatarFileUploader().upload(
                      url,
                      { uri: picked.uri, mimeType: picked.mimeType, width: 0, height: 0 },
                      token,
                      (fraction) => {
                        setAvatarPhase({
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
                setAvatarPhase({
                  name: 'picked',
                  uri: result.picture.uri,
                  mimeType: result.picture.mimeType,
                });
              } else if (result.status === 'error') {
                setAvatarPhase({ name: 'failed', message: result.message });
              }
            }),
          ),
          Effect.catch((failure) =>
            Effect.sync(() => {
              setAvatarPhase({ name: 'failed', message: failure.message });
            }),
          ),
        );
      case 'save': {
        const { picked, ownerId } = operation;
        return Effect.sync(() => {
          setAvatarPhase({
            name: 'uploading',
            uri: picked.uri,
            mimeType: picked.mimeType,
            progress: 0,
          });
        }).pipe(
          // The settings API uploads a local file through `expo-file-system`
          // (React Native's `fetch` cannot send binary bodies); the uploader
          // reports progress back into the phase. In mock mode the mock
          // answers without touching the file.
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
              setProfile((previous) =>
                previous === null ? previous : { ...previous, avatarUrl: result.url },
              );
              setAvatarPhase({ name: 'idle' });
            }),
          ),
          Effect.catch((failure) =>
            Effect.sync(() => {
              setAvatarPhase({ name: 'failed', message: failure.message });
            }),
          ),
        );
      }
      case 'remove':
        return attempt(() => api.removeAvatar(operation.ownerId), friendlyAvatarError).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              setProfile((previous) =>
                previous === null ? previous : { ...previous, avatarUrl: undefined },
              );
              setAvatarPhase({ name: 'removed' });
            }),
          ),
          Effect.catch((failure) =>
            Effect.sync(() => {
              setAvatarPhase({ name: 'failed', message: failure.message });
            }),
          ),
        );
    }
  };

  const [, avatarRun] = useAction(
    (operation: AvatarOperation) =>
      Effect.sync(() => {
        setAvatarBusy(true);
      }).pipe(
        Effect.andThen(avatarEffect(operation)),
        Effect.ensuring(
          Effect.sync(() => {
            setAvatarBusy(false);
          }),
        ),
      ),
    { mode: 'ignore' },
  );

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

  const pickPicture = (): void => {
    avatarRun({ kind: 'pick' });
  };

  const savePickedPicture = (): void => {
    if (profile === null) return;
    if (avatarPhase.name !== 'picked') return;
    avatarRun({ kind: 'save', ownerId: profile.id, picked: avatarPhase });
  };

  const removePicture = (): void => {
    if (profile === null) return;
    avatarRun({ kind: 'remove', ownerId: profile.id });
  };

  // Save is disabled only for the exactly equal value; a casing-only change
  // stays enabled — the server applies it (interval rule, casing updated,
  // nothing retired).
  const unchanged = trimmed !== '' && trimmed === current;
  const nameUnchanged = name.trim() !== '' && name.trim() === (profile?.name ?? '');

  return (
    <SettingsScreenShell
      title="Profile"
      subtitle="Your picture and username, seen by your contacts."
      onBack={() => router.back()}
    >
      {status === 'loading' ? <StateMessage kind="loading" title="Loading…" /> : null}

      {status === 'error' ? (
        <StateMessage
          kind="error"
          title={LOAD_ERROR}
          action={{ label: 'Retry', onPress: reload }}
        />
      ) : null}

      {status === 'ready' && profile !== null ? (
        <View className="gap-3">
          <AvatarControl
            ownerId={profile.id}
            ownerName={profile.name}
            currentUrl={profile.avatarUrl}
            token={avatarToken}
            phase={avatarPhase}
            busy={avatarBusy}
            onPick={pickPicture}
            onSavePicked={savePickedPicture}
            onRemove={removePicture}
          />

          <View className="gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
            <Text className="text-[16px] font-semibold text-foreground">Display name</Text>
            <TextField
              accessibilityLabel="Display name"
              maxLength={64}
              editable={!nameBusy}
              value={name}
              onChangeText={(value) => {
                setNameInput(value);
                setNameSaved(false);
              }}
              placeholder="Your name"
              className="mt-1"
            />
            {nameError !== undefined ? (
              <Text accessibilityRole="alert" className="text-[14px] text-danger">
                {nameError}
              </Text>
            ) : null}
            {nameSaved ? <Text className="text-[14px] text-muted-foreground">Saved.</Text> : null}
            <Button
              variant="default"
              size="sm"
              className="mt-1 self-start"
              accessibilityLabel="Save name"
              disabled={nameBusy || nameUnchanged}
              onPress={saveName}
            >
              <Text>{nameBusy ? 'Saving…' : 'Save name'}</Text>
            </Button>
          </View>

          <HandleField
            value={handle}
            current={current}
            availability={availability}
            error={handleError}
            saved={handleSaved}
            busy={handleBusy}
            saveDisabled={unchanged}
            onChange={(value) => {
              setHandle(value);
              setHandleSaved(false);
            }}
            onSave={saveHandle}
          />
        </View>
      ) : null}
    </SettingsScreenShell>
  );
}
