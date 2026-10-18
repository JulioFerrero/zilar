import { useFocusEffect, useRouter } from 'expo-router';
import { Effect } from 'effect';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { ProfileView } from '@/components/profile/profile-view';
import { createPicturePicker, createAvatarFileUploader } from '@/components/settings/avatar-native';
import type { PickedPicture } from '@/components/settings/avatar-native';
import { friendlyAvatarError } from '@/components/settings/profile-logic';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { StateMessage } from '@/components/ui/state-message';
import { fromApi } from '@zilar/client-core';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { goBackOrHome } from '@/lib/navigation';
import { getSessionToken } from '@/lib/session-token';
import { ProfileApiError, type MyProfile } from '@/lib/profile-api';
import { useProfileApi } from '@/components/settings/use-profile-api';

type ProfileStatus = 'loading' | 'ready' | 'error';

// One photo run at a time: a tap while one is waiting is dropped.
type PhotoJob =
  | { kind: 'pick' }
  | { kind: 'save'; profile: MyProfile; picked: PickedPicture }
  | { kind: 'remove'; profile: MyProfile };

const sessionTokenEffect = Effect.tryPromise({
  try: () => getSessionToken(),
  catch: (cause) => cause,
});

export default function OwnProfileScreen() {
  return (
    <RequireAuth>
      <OwnProfile />
    </RequireAuth>
  );
}

function OwnProfile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { api } = useProfileApi();
  const [status, setStatus] = useState<ProfileStatus>('loading');
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [photoError, setPhotoError] = useState('');
  // Staged pick: only the explicit Save uploads.
  const [staged, setStaged] = useState<PickedPicture | null>(null);

  const load = useCallback(() => {
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    Effect.runFork(
      Effect.all([fromApi(() => api.getMe()), sessionTokenEffect], {
        concurrency: 'unbounded',
      }).pipe(
        Effect.tap(([me, sessionToken]) =>
          Effect.sync(() => {
            setProfile(me);
            setToken(sessionToken);
            setStatus('ready');
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => setStatus((current) => (current === 'ready' ? current : 'error'))),
        ),
      ),
    );
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const uploadEffect = (url: string, picked: PickedPicture): Effect.Effect<unknown, unknown> =>
    (token === undefined ? sessionTokenEffect : Effect.succeed(token)).pipe(
      Effect.flatMap((sessionToken): Effect.Effect<unknown, unknown> =>
        sessionToken === undefined
          ? Effect.fail(new ProfileApiError(401, 'unauthorized', 'No session'))
          : Effect.tryPromise({
              try: () =>
                createAvatarFileUploader().upload(
                  url,
                  { uri: picked.uri, mimeType: picked.mimeType, width: 0, height: 0 },
                  sessionToken,
                ),
              catch: (cause) => cause,
            }),
      ),
    );

  const [photoState, runPhoto] = useAction((job: PhotoJob): Effect.Effect<void> => {
    switch (job.kind) {
      case 'pick':
        return Effect.tryPromise({
          try: () => createPicturePicker().pickPicture(),
          catch: (cause) => cause,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              if (result.status === 'picked') {
                setStaged(result.picture);
              } else if (result.status === 'error') {
                setPhotoError(result.message);
              }
            }),
          ),
          Effect.catch(() =>
            Effect.sync(() => {
              setPhotoError('Could not pick that picture. Try again.');
            }),
          ),
          Effect.asVoid,
        );
      case 'save': {
        const picked = job.picked;
        const uploader = (url: string): Promise<unknown> =>
          Effect.runPromise(uploadEffect(url, picked));
        return Effect.tryPromise({
          try: () =>
            api.uploadAvatar(job.profile.id, new Blob([], { type: picked.mimeType }), uploader),
          catch: (cause) => cause,
        }).pipe(
          Effect.tap((saved) =>
            Effect.sync(() => {
              setProfile({ ...job.profile, avatarUrl: saved.url });
              setStaged(null);
            }),
          ),
          Effect.catch((error: unknown) =>
            Effect.sync(() => {
              setPhotoError(friendlyAvatarError(error));
            }),
          ),
          Effect.asVoid,
        );
      }
      case 'remove':
        return Effect.tryPromise({
          try: () => api.removeAvatar(job.profile.id),
          catch: (cause) => cause,
        }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              setProfile({ ...job.profile, avatarUrl: undefined });
            }),
          ),
          Effect.catch((error: unknown) =>
            Effect.sync(() => {
              setPhotoError(friendlyAvatarError(error));
            }),
          ),
          Effect.asVoid,
        );
    }
  });
  const photoBusy = isWaiting(photoState);

  const pickPhoto = (): void => {
    setPhotoError('');
    runPhoto({ kind: 'pick' });
  };

  const savePhoto = (): void => {
    if (profile === null || staged === null) {
      return;
    }
    setPhotoError('');
    runPhoto({ kind: 'save', profile, picked: staged });
  };

  const removePhoto = (): void => {
    if (profile === null) {
      return;
    }
    setPhotoError('');
    runPhoto({ kind: 'remove', profile });
  };

  const copyUsername = (current: MyProfile): void => {
    Effect.runFork(
      Effect.tryPromise({ try: () => import('expo-clipboard'), catch: (cause) => cause }).pipe(
        Effect.flatMap((Clipboard): Effect.Effect<unknown, unknown> =>
          current.handle === null
            ? Effect.void
            : Effect.tryPromise({
                try: () => Clipboard.setStringAsync(`@${current.handle}`),
                catch: (cause) => cause,
              }),
        ),
      ),
    );
  };

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top + 8, paddingBottom: 32 + insets.bottom }}
    >
      <ScreenHeader variant="sub" bare title="Profile" onBack={() => goBackOrHome(router)} />
      <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
        <View className="px-4">
          {status === 'loading' ? <StateMessage kind="loading" title="Loading…" /> : null}
          {status === 'error' ? (
            <StateMessage
              kind="error"
              title="Could not load your profile."
              action={{ label: 'Retry', onPress: load }}
            />
          ) : null}
          {status === 'ready' && profile !== null ? (
            <View>
              <ProfileView
                profile={profile}
                token={token}
                photoEdit={{
                  ...(staged === null ? {} : { stagedUri: staged.uri }),
                  busy: photoBusy,
                  canRemove: profile.avatarUrl !== undefined,
                  onSave: savePhoto,
                  onDiscard: () => {
                    setStaged(null);
                    setPhotoError('');
                  },
                  onRemove: removePhoto,
                }}
                onSetPhoto={pickPhoto}
                onEditInfo={() => router.push('/settings/profile')}
                onOpenSettings={() => router.push('/settings')}
                onClaimUsername={() => router.push('/settings/profile')}
                onCopyUsername={() => copyUsername(profile)}
              />
              {photoBusy ? (
                <Text className="mt-2 text-center text-[14px] text-muted-foreground">
                  Saving your picture…
                </Text>
              ) : null}
              {photoError !== '' ? (
                <Text
                  accessibilityRole="alert"
                  className="mt-2 text-center text-[14px] text-danger"
                >
                  {photoError}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
