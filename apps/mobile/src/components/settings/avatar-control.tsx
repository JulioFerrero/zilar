import { Image } from 'expo-image';
import { useColorScheme } from 'nativewind';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Avatar } from '@/components/chat/avatar';
import { Text } from '@/components/ui/text';
import { ACCENT } from '@/lib/colors';
import { asColorScheme } from '@/lib/color-scheme';
import { API_URL } from '@/lib/auth';

import { avatarImageSource, avatarPhaseLabel, type AvatarPhase } from './profile-logic';

type AvatarControlProps = {
  ownerId: string;
  ownerName: string;
  /** The server's picture path (`/api/avatars/<id>`), if any. */
  currentUrl?: string | undefined;
  /** The bearer token for the same-origin picture load, if any. */
  token?: string | undefined;
  phase: AvatarPhase;
  busy: boolean;
  onPick: () => void;
  onSavePicked: () => void;
  onRemove: () => void;
};

/**
 * The profile picture row: the current picture (the relative server path
 * resolved against the API origin, bearer on same-origin only, like the
 * sticker images), Change / Remove keys, the picked preview with a
 * progress bar while it uploads, and the phase line (picked, uploading,
 * failed, removed). A failed image load falls back to the initials.
 */
export function AvatarControl({
  ownerId,
  ownerName,
  currentUrl,
  token,
  phase,
  busy,
  onPick,
  onSavePicked,
  onRemove,
}: AvatarControlProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const picked = phase.name === 'picked' || phase.name === 'uploading' ? phase : null;
  const progress = phase.name === 'uploading' ? phase.progress : null;
  const shown = picked?.uri ?? currentUrl ?? null;
  const uploading = phase.name === 'uploading' || busy;
  const [imageFailed, setImageFailed] = useState(false);
  const source = shown === null ? null : avatarImageSource(shown, API_URL, token);
  return (
    <View
      accessibilityLabel={`${ownerName} picture`}
      className="gap-2 rounded-xl border border-border bg-surface px-3 py-2.5"
    >
      <View className="flex-row items-center gap-3">
        <AvatarPicture
          source={source}
          ownerId={ownerId}
          ownerName={ownerName}
          imageFailed={imageFailed}
          onImageError={() => setImageFailed(true)}
        />
        <View className="flex-row flex-wrap gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={currentUrl === undefined ? 'Add picture' : 'Change picture'}
            disabled={uploading}
            onPress={onPick}
            className="items-center rounded-full bg-accent px-4 py-2 active:opacity-90 disabled:opacity-60"
          >
            <Text className="text-[14px] font-medium text-accent-foreground">
              {currentUrl === undefined ? 'Add picture' : 'Change picture'}
            </Text>
          </Pressable>
          {currentUrl !== undefined ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove picture"
              disabled={uploading}
              onPress={onRemove}
              className="items-center rounded-full border border-border-strong bg-surface px-4 py-2 active:bg-surface-raised disabled:opacity-60"
            >
              <Text className="text-[14px] text-foreground">
                {phase.name === 'uploading' ? 'Working…' : 'Remove'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {picked !== null ? (
        <View className="gap-2">
          {progress !== null ? (
            <View
              accessibilityRole="progressbar"
              accessibilityLabel={`Uploading… ${Math.round(progress * 100)} percent`}
              className="h-1.5 overflow-hidden rounded-full bg-surface-raised"
            >
              <View
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save picture"
              disabled={uploading}
              onPress={onSavePicked}
              className="items-center self-start rounded-full bg-accent px-4 py-2 active:opacity-90 disabled:opacity-60"
            >
              <Text className="text-[14px] font-medium text-accent-foreground">Save picture</Text>
            </Pressable>
          )}
        </View>
      ) : null}
      {uploading && phase.name === 'uploading' ? (
        <View className="flex-row items-center gap-2">
          <ActivityIndicator size="small" color={ACCENT[scheme]} />
          <Text className="text-[14px] text-muted-foreground">
            {avatarPhaseLabel(phase, currentUrl !== undefined)}
          </Text>
        </View>
      ) : (
        <Text
          accessibilityRole={phase.name === 'failed' ? 'alert' : 'text'}
          className={
            phase.name === 'failed'
              ? 'text-[14px] text-danger'
              : 'text-[14px] text-muted-foreground'
          }
        >
          {avatarPhaseLabel(phase, currentUrl !== undefined)}
        </Text>
      )}
    </View>
  );
}

/**
 * The picture itself: the resolved image, or the initials when there is no
 * picture or the image failed to load. Split out so tests cover the
 * fallback without a simulator (the parent only owns the failed flag).
 */
export function AvatarPicture({
  source,
  ownerId,
  ownerName,
  imageFailed,
  onImageError,
}: {
  source: { uri: string; headers?: { authorization: string } } | null;
  ownerId: string;
  ownerName: string;
  imageFailed: boolean;
  onImageError: () => void;
}) {
  if (source === null || imageFailed) {
    return <Avatar id={ownerId} name={ownerName} size={64} />;
  }
  return (
    <Image
      source={source}
      accessibilityLabel={`${ownerName} picture`}
      style={{ width: 64, height: 64, borderRadius: 32 }}
      contentFit="cover"
      onError={onImageError}
    />
  );
}
