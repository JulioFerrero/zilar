import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { ProfileView } from '@/components/profile/profile-view';
import { createPicturePicker, createAvatarFileUploader } from '@/components/settings/avatar-native';
import type { PickedPicture } from '@/components/settings/avatar-native';
import { friendlyAvatarError } from '@/components/settings/profile-logic';
import { Text } from '@/components/ui/text';
import { StateMessage } from '@/components/ui/state-message';
import { getSessionToken } from '@/lib/session-token';
import { ProfileApiError, type MyProfile } from '@/lib/profile-api';
import { useProfileApi } from '@/components/settings/use-profile-api';

type ProfileStatus = 'loading' | 'ready' | 'error';

export default function ProfileTabScreen() {
  return (
    <RequireAuth>
      <ProfileTab />
    </RequireAuth>
  );
}

/**
 * The Profile tab: the picture, name, presence, action keys and info card
 * (`ProfileView`), with the same loading and error states as
 * `settings/profile.tsx`. "Set photo" runs the existing avatar picker flow
 * from `avatar-control.tsx` (pick, transcode, upload); "Edit info" opens
 * `/settings/profile`; "Settings" jumps to the Settings tab.
 */
function ProfileTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { api } = useProfileApi();
  const [status, setStatus] = useState<ProfileStatus>('loading');
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [photoError, setPhotoError] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  // Staged pick: Set photo opens the library and stages the preview; only
  // the explicit Save uploads (the settings/profile.tsx pattern).
  const [staged, setStaged] = useState<PickedPicture | null>(null);
  // A ref guard, not state: two rapid taps before the first setState paints
  // would otherwise open two pickers (state reads stale in the same tick).
  const photoRef = useRef(false);

  const load = useCallback(() => {
    setStatus('loading');
    void Promise.all([api.getMe(), getSessionToken()])
      .then(([me, sessionToken]) => {
        setProfile(me);
        setToken(sessionToken);
        setStatus('ready');
      })
      .catch(() => {
        setStatus('error');
      });
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const pickPhoto = (): void => {
    if (photoRef.current) {
      return;
    }
    photoRef.current = true;
    setPhotoBusy(true);
    setPhotoError('');
    void createPicturePicker()
      .pickPicture()
      .then((result) => {
        if (result.status === 'picked') {
          setStaged(result.picture);
        } else if (result.status === 'error') {
          setPhotoError(result.message);
        }
      })
      .catch(() => {
        setPhotoError('Could not pick that picture. Try again.');
      })
      .finally(() => {
        photoRef.current = false;
        setPhotoBusy(false);
      });
  };

  const savePhoto = (): void => {
    if (photoRef.current || profile === null || staged === null) {
      return;
    }
    const picked = staged;
    photoRef.current = true;
    setPhotoBusy(true);
    setPhotoError('');
    const uploader = async (url: string): Promise<unknown> => {
      const sessionToken = token ?? (await getSessionToken());
      if (sessionToken === undefined) {
        throw new ProfileApiError(401, 'unauthorized', 'No session');
      }
      return createAvatarFileUploader().upload(
        url,
        { uri: picked.uri, mimeType: picked.mimeType, width: 0, height: 0 },
        sessionToken,
      );
    };
    void api
      .uploadAvatar(profile.id, new Blob([], { type: picked.mimeType }), uploader)
      .then((saved) => {
        setProfile({ ...profile, avatarUrl: saved.url });
        setStaged(null);
      })
      .catch((error: unknown) => {
        setPhotoError(friendlyAvatarError(error));
      })
      .finally(() => {
        photoRef.current = false;
        setPhotoBusy(false);
      });
  };

  const removePhoto = (): void => {
    if (photoRef.current || profile === null) {
      return;
    }
    photoRef.current = true;
    setPhotoBusy(true);
    setPhotoError('');
    void api
      .removeAvatar(profile.id)
      .then(() => {
        setProfile({ ...profile, avatarUrl: undefined });
      })
      .catch((error: unknown) => {
        setPhotoError(friendlyAvatarError(error));
      })
      .finally(() => {
        photoRef.current = false;
        setPhotoBusy(false);
      });
  };

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top + 8, paddingBottom: 64 + 12 + insets.bottom + 16 }}
    >
      <View className="flex-row items-center px-4 py-2">
        <Text className="text-[28px] font-semibold leading-9 tracking-[-0.02em] text-foreground">
          Profile
        </Text>
      </View>
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
                onCopyUsername={() =>
                  import('expo-clipboard')
                    .then((Clipboard) =>
                      profile.handle === null
                        ? undefined
                        : Clipboard.setStringAsync(`@${profile.handle}`),
                    )
                    .then(() => {})
                }
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
