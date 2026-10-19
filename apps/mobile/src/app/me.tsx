import { avatarSvg, nameSeed } from '@zilar/chat-core';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Effect } from 'effect';
import { Camera, Copy, Pencil, Settings } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';

import { RequireAuth } from '@/auth/RequireAuth';
import { createPicturePicker, createAvatarFileUploader } from '@/components/settings/avatar-native';
import type { PickedPicture } from '@/components/settings/avatar-native';
import { avatarImageSource, friendlyAvatarError } from '@/components/settings/profile-logic';
import { useFocusList } from '@/components/settings/use-focus-list';
import { ActionTiles } from '@/components/ui/action-tiles';
import { Button } from '@/components/ui/button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { StateMessage } from '@/components/ui/state-message';
import { fromApi } from '@zilar/client-core';
import { ApiError } from '@zilar/api-contract';
import { API_URL } from '@/lib/auth';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { goBackOrHome } from '@/lib/navigation';
import { getSessionToken } from '@/lib/session-token';
import type { MyProfile } from '@/lib/profile-api';
import { useProfileApi } from '@/components/settings/use-profile-api';

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
  const [photoError, setPhotoError] = useState('');
  // Staged pick: only the explicit Save uploads.
  const [staged, setStaged] = useState<PickedPicture | null>(null);

  const load = useCallback(
    () =>
      Effect.all([fromApi(() => api.getMe()), sessionTokenEffect], {
        concurrency: 'unbounded',
      }).pipe(Effect.map(([me, token]) => ({ me, token }))),
    [api],
  );

  const { data, setData, status, reload } = useFocusList(load);
  const profile = data?.me ?? null;
  const token = data?.token;

  const uploadEffect = (url: string, picked: PickedPicture): Effect.Effect<unknown, unknown> =>
    (token === undefined ? sessionTokenEffect : Effect.succeed(token)).pipe(
      Effect.flatMap((sessionToken): Effect.Effect<unknown, unknown> =>
        sessionToken === undefined
          ? Effect.fail(new ApiError(401, 'unauthorized', 'No session'))
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

  const catchAvatarError = (error: unknown): Effect.Effect<void> =>
    Effect.sync(() => setPhotoError(friendlyAvatarError(error)));

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
              setData((current) =>
                current === undefined
                  ? current
                  : { ...current, me: { ...job.profile, avatarUrl: saved.url } },
              );
              setStaged(null);
            }),
          ),
          Effect.catch(catchAvatarError),
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
              setData((current) =>
                current === undefined
                  ? current
                  : { ...current, me: { ...job.profile, avatarUrl: undefined } },
              );
            }),
          ),
          Effect.catch(catchAvatarError),
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
              action={{ label: 'Retry', onPress: reload }}
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

interface ProfileViewHandlers {
  onSetPhoto: () => void;
  onEditInfo: () => void;
  onOpenSettings: () => void;
  onClaimUsername: () => void;
  onCopyUsername?: (() => void) | undefined;
}

interface PhotoEdit {
  stagedUri?: string | undefined;
  busy: boolean;
  canRemove: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onRemove: () => void;
}

type ProfileViewProps = ProfileViewHandlers & {
  profile: MyProfile;
  token?: string | undefined;
};

/**
 * The Profile tab body: the centered avatar, name and online line, the three
 * action keys, and the info card. The content is hook-free, so Vitest covers it
 * without a simulator; the wrapper owns the image-failed flag.
 */
function ProfileViewContent({
  profile,
  token,
  imageFailed,
  onImageError,
  photoEdit,
  onSetPhoto,
  onEditInfo,
  onOpenSettings,
  onClaimUsername,
  onCopyUsername,
}: ProfileViewProps & {
  imageFailed: boolean;
  onImageError: () => void;
  photoEdit?: PhotoEdit | undefined;
}) {
  const source =
    profile.avatarUrl === undefined || imageFailed
      ? null
      : avatarImageSource(profile.avatarUrl, API_URL, token);
  // The ball's colour and light come from the name.
  const seed = nameSeed(profile.name) || profile.id;
  return (
    <View className="gap-4">
      <View className="items-center gap-1 pt-4">
        {source === null ? (
          <View
            accessibilityLabel={`${profile.name} picture`}
            style={{
              width: 104,
              height: 104,
              borderRadius: 52,
              overflow: 'hidden',
            }}
          >
            <SvgXml xml={avatarSvg(seed)} width={104} height={104} />
          </View>
        ) : (
          <Image
            source={source}
            accessibilityLabel={`${profile.name} picture`}
            style={{ width: 104, height: 104, borderRadius: 52 }}
            contentFit="cover"
            onError={onImageError}
          />
        )}
        <Text className="mt-2 text-[22px] font-semibold text-foreground">{profile.name}</Text>
        <View className="flex-row items-center gap-1.5">
          <View className="h-2 w-2 rounded-full bg-online" />
          <Text className="text-[13px] text-muted-foreground">online</Text>
        </View>
      </View>

      <ActionTiles
        accessibilityLabel="Profile actions"
        items={[
          { key: 'photo', label: 'Set photo', icon: Camera, onPress: onSetPhoto },
          { key: 'edit', label: 'Edit info', icon: Pencil, onPress: onEditInfo },
          { key: 'settings', label: 'Settings', icon: Settings, onPress: onOpenSettings },
        ]}
      />

      {photoEdit === undefined ? null : <PhotoEditRow edit={photoEdit} stagedName={profile.name} />}

      <View className="gap-0 overflow-hidden rounded-xl border border-border bg-surface">
        {profile.handle === null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Claim a username"
            onPress={onClaimUsername}
            className="flex-row items-center justify-between px-3 py-2.5 active:bg-surface-raised"
          >
            <View className="min-w-0 flex-1">
              <Text className="text-[14px] font-medium text-accent">Claim a username</Text>
              <Text numberOfLines={1} className="mt-0.5 text-[13px] text-muted-foreground">
                Pick your @username
              </Text>
            </View>
          </Pressable>
        ) : (
          <View className="flex-row items-center justify-between px-3 py-2.5">
            <View className="min-w-0 flex-1">
              <Text className="text-[13px]" style={{ color: MUTED_FOREGROUND }}>
                Username
              </Text>
              <Text numberOfLines={1} className="mt-0.5 text-[15px] text-foreground">
                @{profile.handle}
              </Text>
            </View>
            {onCopyUsername === undefined ? null : (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-lg"
                accessibilityLabel="Copy username"
                onPress={onCopyUsername}
              >
                <Copy size={18} color={MUTED_FOREGROUND} />
              </Button>
            )}
          </View>
        )}
        <View className="border-t border-divider px-3 py-2.5">
          <Text className="text-[13px]" style={{ color: MUTED_FOREGROUND }}>
            Email, only you see it
          </Text>
          <Text numberOfLines={1} className="mt-0.5 text-[15px] text-foreground">
            {profile.email}
          </Text>
        </View>
      </View>
    </View>
  );
}

function PhotoEditRow({ edit, stagedName }: { edit: PhotoEdit; stagedName: string }) {
  if (edit.stagedUri !== undefined) {
    return (
      <View className="items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
        <Image
          source={{ uri: edit.stagedUri }}
          accessibilityLabel={`${stagedName} new picture preview`}
          style={{ width: 64, height: 64, borderRadius: 32 }}
          contentFit="cover"
        />
        <View className="flex-row gap-2">
          <Button
            accessibilityLabel="Save picture"
            disabled={edit.busy}
            onPress={edit.onSave}
            variant="default"
            size="default"
          >
            <Text>{edit.busy ? 'Saving…' : 'Save picture'}</Text>
          </Button>
          <Button
            variant="outline"
            className="rounded-full"
            accessibilityLabel="Discard picture"
            disabled={edit.busy}
            onPress={edit.onDiscard}
          >
            <Text className="text-[14px] text-foreground">Discard</Text>
          </Button>
        </View>
      </View>
    );
  }
  if (!edit.canRemove) {
    return null;
  }
  return (
    <View className="items-center">
      <Button
        variant="outline"
        className="rounded-full"
        accessibilityLabel="Remove picture"
        disabled={edit.busy}
        onPress={edit.onRemove}
      >
        <Text className="text-[14px] text-foreground">
          {edit.busy ? 'Working…' : 'Remove picture'}
        </Text>
      </Button>
    </View>
  );
}

function ProfileView(props: ProfileViewProps & { photoEdit?: PhotoEdit | undefined }) {
  // The failed url, not a boolean: a 404 for a stale url clears itself when
  // `setProfile` carries the new `avatarUrl`, instead of sticking until remount.
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
  return (
    <ProfileViewContent
      {...props}
      imageFailed={failedUrl !== undefined && failedUrl === props.profile.avatarUrl}
      onImageError={() => setFailedUrl(props.profile.avatarUrl)}
    />
  );
}
