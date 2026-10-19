import { avatarIdentity } from '@zilar/chat-core';
import { Effect } from 'effect';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Avatar } from '@/components/chat/avatar';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { ACCENT } from '@/lib/colors';
import { API_URL } from '@/lib/auth';
import { useAction } from '@/lib/effect/use-action';

import { createPicturePicker } from './avatar-native';
import { avatarImageSource, avatarPhaseLabel, type AvatarPhase } from './profile-logic';

export type PicturePick = { uri: string; mimeType: string };

type PictureOperation =
  | { readonly kind: 'pick' }
  | { readonly kind: 'save'; readonly picked: PicturePick }
  | { readonly kind: 'remove' };

const PICK_ERROR = 'Could not pick that picture. Try again.';

function rejectionMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function uploading(picked: PicturePick, progress: number): AvatarPhase {
  return { name: 'uploading', uri: picked.uri, mimeType: picked.mimeType, progress };
}

type PictureEditorOptions = {
  upload: (picked: PicturePick, onProgress: (fraction: number) => void) => Promise<{ url: string }>;
  remove: () => Promise<void>;
  onChanged: (url: string | undefined) => void;
};

export function usePictureEditor({ upload, remove, onChanged }: PictureEditorOptions) {
  const [phase, setPhase] = useState<AvatarPhase>({ name: 'idle' });
  const [busy, setBusy] = useState(false);

  const run = async (operation: PictureOperation): Promise<void> => {
    if (operation.kind === 'pick') {
      try {
        const result = await createPicturePicker().pickPicture();
        if (result.status === 'picked') {
          setPhase({
            name: 'picked',
            uri: result.picture.uri,
            mimeType: result.picture.mimeType,
          });
        } else if (result.status === 'error') {
          setPhase({ name: 'failed', message: result.message });
        }
      } catch {
        setPhase({ name: 'failed', message: PICK_ERROR });
      }
      return;
    }
    if (operation.kind === 'save') {
      const { picked } = operation;
      setPhase(uploading(picked, 0));
      try {
        const result = await upload(picked, (progress) => setPhase(uploading(picked, progress)));
        onChanged(result.url);
        setPhase({ name: 'idle' });
      } catch (cause) {
        setPhase({ name: 'failed', message: rejectionMessage(cause) });
      }
      return;
    }
    try {
      await remove();
      onChanged(undefined);
      setPhase({ name: 'removed' });
    } catch (cause) {
      setPhase({ name: 'failed', message: rejectionMessage(cause) });
    }
  };

  const [, runAction] = useAction(
    (operation: PictureOperation) =>
      Effect.promise(async () => {
        setBusy(true);
        try {
          await run(operation);
        } finally {
          setBusy(false);
        }
      }),
    { mode: 'ignore' },
  );

  const pick = (): void => {
    runAction({ kind: 'pick' });
  };

  const savePicked = (): void => {
    if (phase.name === 'picked') {
      runAction({ kind: 'save', picked: phase });
    }
  };

  const removePicture = (): void => {
    runAction({ kind: 'remove' });
  };

  const reset = (): void => {
    setPhase({ name: 'idle' });
  };

  return { phase, busy, pick, savePicked, remove: removePicture, reset };
}

type AvatarControlProps = {
  ownerId: string;
  ownerName: string;
  currentUrl?: string | undefined;
  token?: string | undefined;
  phase: AvatarPhase;
  busy: boolean;
  onPick: () => void;
  onSavePicked: () => void;
  onRemove: () => void;
};

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
          <Button
            variant="default"
            size="sm"
            accessibilityLabel={currentUrl === undefined ? 'Add picture' : 'Change picture'}
            disabled={uploading}
            onPress={onPick}
          >
            {currentUrl === undefined ? <Text>Add picture</Text> : <Text>Change picture</Text>}
          </Button>
          {currentUrl !== undefined ? (
            <Button
              variant="outline"
              size="sm"
              accessibilityLabel="Remove picture"
              disabled={uploading}
              onPress={onRemove}
            >
              <Text>{phase.name === 'uploading' ? 'Working…' : 'Remove'}</Text>
            </Button>
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
            <Button
              variant="default"
              size="sm"
              className="self-start"
              accessibilityLabel="Save picture"
              disabled={uploading}
              onPress={onSavePicked}
            >
              <Text>Save picture</Text>
            </Button>
          )}
        </View>
      ) : null}
      {uploading && phase.name === 'uploading' ? (
        <View className="flex-row items-center gap-2">
          <ActivityIndicator size="small" color={ACCENT} />
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
    return (
      <Avatar
        seed={avatarIdentity({ name: ownerName, id: ownerId }).seed}
        name={ownerName}
        size={64}
      />
    );
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
