import { initials } from '@zilar/chat-core';
import { Image } from 'expo-image';
import { Camera, Copy, Pencil, Settings } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { asColorScheme } from '@/lib/color-scheme';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';

import { avatarImageSource } from '@/components/settings/profile-logic';
import { API_URL } from '@/lib/auth';
import type { MyProfile } from '@/lib/profile-api';

export interface ProfileViewHandlers {
  onSetPhoto: () => void;
  onEditInfo: () => void;
  onOpenSettings: () => void;
  onClaimUsername: () => void;
  onCopyUsername?: (() => void) | undefined;
}

/**
 * The staged photo edit under the action keys: the picked preview with
 * explicit Save / Discard keys (picking never uploads on its own, the
 * `settings/profile.tsx` pattern), or the Remove key when there is a
 * current picture and nothing staged.
 */
export interface PhotoEdit {
  stagedUri?: string | undefined;
  busy: boolean;
  canRemove: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onRemove: () => void;
}

type ProfileViewProps = ProfileViewHandlers & {
  profile: MyProfile;
  /** The bearer for the same-origin picture load, if any. */
  token?: string | undefined;
};

function ActionKey({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="flex-1 items-center justify-center gap-1 rounded-xl px-2 py-3 active:opacity-90"
      style={{
        experimental_backgroundImage: 'linear-gradient(180deg, #2c2c2c, #151515)',
        borderWidth: 1,
        borderColor: '#050505',
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.65), 0 1px 0 rgba(0,0,0,0.95), 0 3px 6px -1px rgba(0,0,0,0.75)',
      }}
    >
      {children}
      <Text className="text-[11px] text-foreground">{label}</Text>
    </Pressable>
  );
}

/**
 * The Profile tab body: the centered avatar, name and online line, the
 * three action keys, and the info card. The content is hook-free, so Vitest
 * covers it without a simulator; the wrapper below owns the image-failed
 * flag and the `(tabs)/profile.tsx` screen owns the loading.
 */
export function ProfileViewContent({
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
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const source =
    profile.avatarUrl === undefined || imageFailed
      ? null
      : avatarImageSource(profile.avatarUrl, API_URL, token);
  return (
    <View className="gap-4">
      <View className="items-center gap-1 pt-4">
        {source === null ? (
          <View
            accessibilityLabel={`${profile.name} picture`}
            className="items-center justify-center"
            style={{
              width: 104,
              height: 104,
              borderRadius: 52,
              backgroundColor: '#262626',
              borderWidth: 1,
              borderColor: '#333333',
            }}
          >
            <Text className="font-semibold text-foreground" style={{ fontSize: 36 }}>
              {initials(profile.name)}
            </Text>
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

      <View className="flex-row gap-2">
        <ActionKey label="Set photo" onPress={onSetPhoto}>
          <Camera size={20} color={ICON[scheme]} />
        </ActionKey>
        <ActionKey label="Edit info" onPress={onEditInfo}>
          <Pencil size={20} color={ICON[scheme]} />
        </ActionKey>
        <ActionKey label="Settings" onPress={onOpenSettings}>
          <Settings size={20} color={ICON[scheme]} />
        </ActionKey>
      </View>

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
              <Text className="text-[13px]" style={{ color: MUTED_FOREGROUND[scheme] }}>
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
                <Copy size={18} color={MUTED_FOREGROUND[scheme]} />
              </Button>
            )}
          </View>
        )}
        <View className="border-t border-divider px-3 py-2.5">
          <Text className="text-[13px]" style={{ color: MUTED_FOREGROUND[scheme] }}>
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

/**
 * The staged photo edit: the picked `file://` preview with explicit Save /
 * Discard keys, or the Remove key when there is a current picture. Nothing
 * uploads until Save, so an accidental Set-photo tap stages only.
 */
export function PhotoEditRow({ edit, stagedName }: { edit: PhotoEdit; stagedName: string }) {
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

/** The stateful Profile tab body: the content plus the failed-url flag. */
export function ProfileView(props: ProfileViewProps & { photoEdit?: PhotoEdit | undefined }) {
  // The failed url, not a boolean: a 404 for a stale url clears itself when
  // `setProfile` carries the new `avatarUrl`, instead of sticking on
  // initials until remount.
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
  return (
    <ProfileViewContent
      {...props}
      imageFailed={failedUrl !== undefined && failedUrl === props.profile.avatarUrl}
      onImageError={() => setFailedUrl(props.profile.avatarUrl)}
    />
  );
}
