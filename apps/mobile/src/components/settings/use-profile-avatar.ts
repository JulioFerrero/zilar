import { Effect } from 'effect';
import { useState } from 'react';

import { useAction } from '@/lib/effect/use-action';
import { ProfileApiError, type ProfileApi } from '@/lib/profile-api';
import { getSessionToken } from '@/lib/session-token';

import { createAvatarFileUploader, createPicturePicker } from '@/components/settings/avatar-native';
import { friendlyAvatarError, type AvatarPhase } from '@/components/settings/profile-logic';
import type { ProfileAttempt } from '@/components/settings/use-profile-settings';

type PickedAvatar = Extract<AvatarPhase, { name: 'picked' }>;

/** One avatar action; the picker, the save and the removal share one slot. */
type AvatarOperation =
  | { readonly kind: 'pick' }
  | { readonly kind: 'save'; readonly ownerId: string; readonly picked: PickedAvatar }
  | { readonly kind: 'remove'; readonly ownerId: string };

const PICK_ERROR = 'Could not pick that picture. Try again.';

/** The avatar state and the three actions the profile screen offers. */
export interface ProfileAvatar {
  readonly token: string | undefined;
  readonly phase: AvatarPhase;
  readonly busy: boolean;
  /** Resets the phase and stores the bearer a profile load just fetched. */
  readonly reset: (token: string | undefined) => void;
  readonly pick: () => void;
  readonly savePicked: (ownerId: string) => void;
  readonly remove: (ownerId: string) => void;
}

/**
 * Owns the profile avatar: the picked picture, the upload, and the removal.
 * It is a leaf of the settings split, so the profile call wrapper arrives as
 * `attempt` and the profile it updates is written through `setAvatarUrl`.
 */
export function useProfileAvatar(
  api: ProfileApi,
  attempt: ProfileAttempt,
  setAvatarUrl: (url: string | undefined) => void,
): ProfileAvatar {
  const [token, setToken] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<AvatarPhase>({ name: 'idle' });
  const [busy, setBusy] = useState(false);

  // The avatar uploader the settings API calls with the upload url. Its
  // failures reach `friendlyAvatarError` unchanged (runPromise rejects with
  // the error value), so the same sentence shows as before.
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
