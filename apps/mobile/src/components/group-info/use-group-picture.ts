import { Effect } from 'effect';
import { useEffect, useState } from 'react';

import {
  AVATAR_EXPORT_SIDE,
  createAvatarFileUploader,
  createPicturePicker,
} from '@/components/settings/avatar-native';
import { friendlyAvatarError, type AvatarPhase } from '@/components/settings/profile-logic';
import { API_URL } from '@/lib/auth';
import { useAction } from '@/lib/effect/use-action';
import { getSessionToken } from '@/lib/session-token';

type PickedAvatar = Extract<AvatarPhase, { name: 'picked' }>;

type PictureOperation =
  | { readonly kind: 'pick' }
  | { readonly kind: 'save'; readonly picked: PickedAvatar }
  | { readonly kind: 'remove' };

const PICK_ERROR = 'Could not pick that picture. Try again.';
const SAVE_ERROR = 'Could not save the picture. Try again.';
const REMOVE_ERROR = 'Could not remove the picture. Try again.';

export function groupAvatarSlot(groupId: string): string {
  return `${API_URL}/api/avatars/group/${encodeURIComponent(groupId)}`;
}

export interface GroupPicture {
  readonly token: string | undefined;
  readonly phase: AvatarPhase;
  readonly busy: boolean;
  readonly shownUrl: string | undefined;
  readonly pick: () => void;
  readonly savePicked: () => void;
  readonly remove: () => void;
}

/**
 * The group Settings page's picture: pick, upload the transcoded PNG to the
 * group's avatar slot, and remove it. `onChanged` refreshes the detail and the
 * chat list, because the phone's group header picture comes from the chat row.
 */
export function useGroupPicture(
  groupId: string,
  currentUrl: string | undefined,
  onChanged: () => void,
): GroupPicture {
  const [token, setToken] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<AvatarPhase>({ name: 'idle' });
  const [busy, setBusy] = useState(false);
  // The url a write just produced; null until then, so the detail's url wins.
  const [changedUrl, setChangedUrl] = useState<string | undefined | null>(null);

  useEffect(() => {
    let alive = true;
    getSessionToken()
      .then((next) => {
        if (alive) {
          setToken(next);
        }
      })
      .catch(() => {
        // No bearer: the picture falls back to the initials.
      });
    return () => {
      alive = false;
    };
  }, []);

  // The bearer already loaded, else one fresh read; a failure reads as none.
  const readToken = (): Effect.Effect<string | undefined> =>
    Effect.promise(() => getSessionToken().catch(() => undefined));

  const pickEffect = (): Effect.Effect<void> =>
    Effect.tryPromise({
      try: () => createPicturePicker().pickPicture(),
      catch: () => PICK_ERROR,
    }).pipe(
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
      Effect.catch((message) => Effect.sync(() => setPhase({ name: 'failed', message }))),
    );

  const saveEffect = (picked: PickedAvatar): Effect.Effect<void> =>
    Effect.sync(() =>
      setPhase({
        name: 'uploading',
        uri: picked.uri,
        mimeType: picked.mimeType,
        progress: 0,
      }),
    ).pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const bearer = yield* readToken();
          if (bearer === undefined) {
            return yield* Effect.fail(SAVE_ERROR);
          }
          return yield* Effect.tryPromise({
            try: () =>
              createAvatarFileUploader().upload(
                groupAvatarSlot(groupId),
                {
                  uri: picked.uri,
                  mimeType: picked.mimeType,
                  width: AVATAR_EXPORT_SIDE,
                  height: AVATAR_EXPORT_SIDE,
                },
                bearer,
                (fraction) =>
                  setPhase({
                    name: 'uploading',
                    uri: picked.uri,
                    mimeType: picked.mimeType,
                    progress: fraction,
                  }),
              ),
            catch: (cause) => friendlyAvatarError(cause),
          });
        }),
      ),
      Effect.tap((uploaded) =>
        Effect.sync(() => {
          setChangedUrl(uploaded.url);
          setPhase({ name: 'idle' });
          onChanged();
        }),
      ),
      Effect.catch((message) => Effect.sync(() => setPhase({ name: 'failed', message }))),
    );

  const removeEffect = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      const bearer = yield* readToken();
      if (bearer === undefined) {
        return yield* Effect.fail(REMOVE_ERROR);
      }
      yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(groupAvatarSlot(groupId), {
            method: 'DELETE',
            credentials: 'omit',
            headers: { authorization: `Bearer ${bearer}` },
          });
          if (!response.ok) {
            throw new Error(REMOVE_ERROR);
          }
        },
        catch: () => REMOVE_ERROR,
      });
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          setChangedUrl(undefined);
          setPhase({ name: 'removed' });
          onChanged();
        }),
      ),
      Effect.catch((message) => Effect.sync(() => setPhase({ name: 'failed', message }))),
    );

  const operation = (op: PictureOperation): Effect.Effect<void> => {
    if (op.kind === 'pick') {
      return pickEffect();
    }
    return op.kind === 'save' ? saveEffect(op.picked) : removeEffect();
  };

  const [, run] = useAction(
    (op: PictureOperation) =>
      Effect.sync(() => {
        setBusy(true);
      }).pipe(
        Effect.andThen(operation(op)),
        Effect.ensuring(
          Effect.sync(() => {
            setBusy(false);
          }),
        ),
      ),
    { mode: 'ignore' },
  );

  return {
    token,
    phase,
    busy,
    shownUrl: changedUrl !== null ? changedUrl : currentUrl,
    pick: () => run({ kind: 'pick' }),
    savePicked: () => {
      if (phase.name === 'picked') {
        run({ kind: 'save', picked: phase });
      }
    },
    remove: () => run({ kind: 'remove' }),
  };
}
