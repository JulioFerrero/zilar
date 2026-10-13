import type { Attachment } from '@zilar/protocol';
import { FileText, Image as ImageIcon } from 'lucide-react-native';
import { Effect } from 'effect';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';

import type { AttachmentChoice } from '@/components/chat/attach-sheet';
import { GalleryGrid } from '@/components/chat/attach/gallery-grid';
import type { GalleryAssets } from '@/components/chat/attach/use-gallery-assets';
import { Text } from '@/components/ui/text';
import type { GalleryAsset } from '@/lib/attachment-native';
import type { PickedFile } from '@/lib/attachment-ports';
import { ICON } from '@/lib/colors';
import { primaryKey } from '@/lib/depth';
import { isWaiting, useAction } from '@/lib/effect/use-action';

const DENIED_MESSAGE = "Zilar can't see your photos.";
const ERROR_MESSAGE = "Couldn't load your photos.";
const STAGE_FAILED_MESSAGE = 'Could not prepare those photos. Try again.';

/**
 * The Gallery tab (T-1320): the recent-assets grid with the camera tile, multi
 * select and the "Send N" bar that stages the picked files through the
 * composer's strip. When the media library is not available it falls back to
 * the mock demo attachments, and a denied permission offers the system
 * settings or the plain gallery picker. Pure view plus selection: the composer
 * owns the send.
 */
export function GalleryTab({
  gallery,
  busy,
  demoAttachments,
  onPick,
  onPickDemo,
  onStageFiles,
}: {
  gallery: GalleryAssets;
  busy: boolean;
  demoAttachments?: Attachment[] | undefined;
  onPick: (choice: AttachmentChoice) => void;
  onPickDemo?: ((attachment: Attachment) => void) | undefined;
  onStageFiles: (files: PickedFile[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [stageError, setStageError] = useState<string | undefined>(undefined);
  const [sendState, sendSelected] = useAction((files: readonly GalleryAsset[]) =>
    Effect.tryPromise({
      try: () => gallery.stageAssets(files),
      catch: () => undefined,
    }).pipe(
      Effect.tap((staged) =>
        Effect.sync(() => {
          if (staged === undefined) {
            setStageError(STAGE_FAILED_MESSAGE);
            return;
          }
          if (staged.status === 'error') {
            setStageError(staged.message);
            return;
          }
          if (staged.files.length > 0) {
            onStageFiles(staged.files);
          }
        }),
      ),
    ),
  );
  const staging = isWaiting(sendState);

  const demos = demoAttachments ?? [];
  // Mock mode (or a device with no library): the demo attachments stand in, so
  // the flow still works without a server. The sheet's other rows are gone.
  if (gallery.status !== 'ready' && demos.length > 0 && onPickDemo !== undefined) {
    return <DemoAttachments demos={demos} busy={busy} onPickDemo={onPickDemo} />;
  }
  if (gallery.status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center gap-2">
        <ActivityIndicator accessibilityLabel="Loading photos" />
        <Text className="text-[13px] text-muted-foreground">Loading photos…</Text>
      </View>
    );
  }
  if (gallery.status === 'denied') {
    return (
      <MessageState
        message={DENIED_MESSAGE}
        primary={{ label: 'Open settings', onPress: () => void Linking.openSettings() }}
        secondary={{ label: 'Choose from gallery', onPress: () => onPick('library') }}
      />
    );
  }
  if (gallery.status === 'error') {
    return (
      <MessageState
        message={ERROR_MESSAGE}
        secondary={{ label: 'Choose from gallery', onPress: () => onPick('library') }}
      />
    );
  }

  const toggle = (id: string) => {
    setStageError(undefined);
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };
  const selectedAssets = selected
    .map((id) => gallery.assets.find((asset) => asset.id === id))
    .filter((asset): asset is GalleryAsset => asset !== undefined);

  const send = () => {
    if (selectedAssets.length === 0 || staging) {
      return;
    }
    setStageError(undefined);
    sendSelected(selectedAssets);
  };

  return (
    <View className="min-h-0 flex-1">
      <GalleryGrid
        assets={gallery.assets}
        selected={selected}
        busy={busy}
        hasMore={gallery.hasMore}
        onToggle={toggle}
        onCamera={() => onPick('camera')}
        onLoadMore={gallery.loadMore}
      />
      {stageError === undefined ? null : (
        <Text role="alert" className="px-1 py-1 text-[13px] text-danger">
          {stageError}
        </Text>
      )}
      {selected.length === 0 ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Send ${selected.length}`}
          disabled={busy || staging}
          onPress={send}
          className="mt-1 items-center justify-center rounded-[10px] py-3 active:opacity-90 disabled:opacity-60"
          style={primaryKey}
        >
          {staging ? (
            <ActivityIndicator accessibilityLabel="Preparing photos" color="#0a0a0a" />
          ) : (
            <Text className="text-[15px] font-semibold" style={{ color: '#0a0a0a' }}>
              Send {selected.length}
            </Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

function MessageState({
  message,
  primary,
  secondary,
}: {
  message: string;
  primary?: { label: string; onPress: () => void } | undefined;
  secondary?: { label: string; onPress: () => void } | undefined;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-6">
      <Text className="text-center text-[15px] text-foreground">{message}</Text>
      {primary === undefined ? null : <StateButton action={primary} primary />}
      {secondary === undefined ? null : <StateButton action={secondary} />}
    </View>
  );
}

function StateButton({
  action,
  primary = false,
}: {
  action: { label: string; onPress: () => void };
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={action.onPress}
      className="min-w-[160px] items-center justify-center rounded-[10px] px-4 py-2.5 active:opacity-90"
      style={
        primary ? primaryKey : { backgroundColor: 'transparent', borderWidth: 1, borderColor: ICON }
      }
    >
      <Text className="text-[14px] font-semibold" style={{ color: primary ? '#0a0a0a' : ICON }}>
        {action.label}
      </Text>
    </Pressable>
  );
}

function DemoAttachments({
  demos,
  busy,
  onPickDemo,
}: {
  demos: readonly Attachment[];
  busy: boolean;
  onPickDemo: (attachment: Attachment) => void;
}) {
  const iconColor = ICON;
  return (
    <View className="pt-1">
      <Text className="px-1 py-1 text-[13px] font-semibold text-muted-foreground">
        Try one (demo)
      </Text>
      {demos.map((attachment) => (
        <Pressable
          key={attachment.url}
          accessibilityRole="button"
          accessibilityLabel={`Attach demo ${attachment.name}`}
          disabled={busy}
          onPress={() => onPickDemo(attachment)}
          className="flex-row items-center gap-3 px-1 py-2 active:bg-surface-raised disabled:opacity-60"
        >
          <View className="h-9 w-9 items-center justify-center rounded-[8px] bg-surface-raised">
            {attachment.kind === 'image' ? (
              <ImageIcon size={20} color={iconColor} />
            ) : (
              <FileText size={20} color={iconColor} />
            )}
          </View>
          <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] text-foreground">
            {attachment.name}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
