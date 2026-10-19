import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View, useWindowDimensions, Pressable } from 'react-native';
import { Globe, Lock, Plus, Repeat, Smile, Trash2, TriangleAlert } from 'lucide-react-native';
import { Image } from 'expo-image';

import { RequireStickersAuth } from '@/components/stickers/require-stickers-auth';
import { MAX_PACK_STICKERS, type EditorNewItem } from '@/components/stickers/pack-editor';
import {
  usePackEditor,
  type PackEditorDeps,
  type PackVisibility,
} from '@/components/stickers/use-pack-editor';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StateMessage } from '@/components/ui/state-message';
import { Text, TextField } from '@/components/ui/text';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { favoriteTileSize } from './stickers';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { DANGER, FOREGROUND, MUTED_FOREGROUND } from '@/lib/colors';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { API_URL } from '@/lib/auth';
import { isSameOriginStickerUrl, stickerImageSource, type StickerItem } from '@/lib/stickers';
import { cn } from '@/lib/utils';

function resolveTile(
  selection: PackTileSelection | null,
  visibleSaved: StickerItem[],
  fresh: EditorNewItem[],
): { saved: StickerItem | undefined; fresh: EditorNewItem | undefined } {
  if (selection === null) {
    return { saved: undefined, fresh: undefined };
  }
  if (selection.kind === 'saved') {
    return {
      saved: visibleSaved.find((sticker) => sticker.id === selection.stickerId),
      fresh: undefined,
    };
  }
  return { saved: undefined, fresh: fresh.find((item) => item.key === selection.key) };
}

function PackTileSheet({
  selection,
  visibleSaved,
  fresh,
  token,
  saving,
  onClose,
  onChangeEmoji,
  onRetry,
  onRemoveSaved,
  onRemoveFresh,
}: {
  selection: PackTileSelection | null;
  visibleSaved: StickerItem[];
  fresh: EditorNewItem[];
  token: string | undefined;
  saving: boolean;
  onClose: () => void;
  onChangeEmoji: (key: string, value: string) => void;
  onRetry: (key: string) => void;
  onRemoveSaved: (stickerId: string) => void;
  onRemoveFresh: (key: string) => void;
}) {
  const { saved, fresh: freshItem } = resolveTile(selection, visibleSaved, fresh);
  const visible = saved !== undefined || freshItem !== undefined;
  const source =
    freshItem !== undefined
      ? { uri: freshItem.uri }
      : saved !== undefined && isSameOriginStickerUrl(saved.url, API_URL)
        ? stickerImageSource(saved.url, API_URL, token)
        : undefined;
  const changeEmoji =
    freshItem === undefined ? undefined : (value: string) => onChangeEmoji(freshItem.key, value);
  const retry =
    freshItem !== undefined && freshItem.status === 'uploadFailed'
      ? () => onRetry(freshItem.key)
      : undefined;
  const remove =
    saved !== undefined
      ? () => onRemoveSaved(saved.id)
      : freshItem !== undefined
        ? () => onRemoveFresh(freshItem.key)
        : undefined;

  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close sticker actions"
      header={
        <View className="items-center px-4 py-3">
          <View className="h-24 w-24 items-center justify-center overflow-hidden rounded-xl bg-surface-raised">
            {source === undefined ? null : (
              <Image source={source} style={{ width: 96, height: 96 }} contentFit="contain" />
            )}
          </View>
        </View>
      }
    >
      {changeEmoji === undefined ? null : (
        <View className="px-4 py-3">
          <TextField
            label="Emoji"
            value={freshItem?.emoji ?? ''}
            onChangeText={changeEmoji}
            maxLength={8}
            editable={!saving}
            accessibilityLabel="Emoji"
            className="h-11"
          />
        </View>
      )}
      {retry === undefined ? null : (
        <ActionSheetItem label="Try again" disabled={saving} onPress={retry} />
      )}
      {remove === undefined ? null : (
        <ActionSheetItem label="Remove" destructive disabled={saving} onPress={remove} />
      )}
    </ActionSheet>
  );
}

function PackActions({
  saving,
  progress,
  formError,
  isCreate,
  saveDisabled,
  packId,
  title,
  onSave,
  onBack,
  onAskDelete,
}: {
  saving: boolean;
  progress: { done: number; total: number } | undefined;
  formError: string;
  isCreate: boolean;
  saveDisabled: boolean;
  packId: string | undefined;
  title: string;
  onSave: () => void;
  onBack: () => void;
  onAskDelete: () => void;
}) {
  return (
    <>
      {saving && progress !== undefined && progress.total > 0 ? (
        <View accessibilityLiveRegion="polite">
          <Text className="text-[14px] text-muted-foreground">
            Uploading {progress.done} of {progress.total}…
          </Text>
        </View>
      ) : null}
      {formError !== '' ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {formError}
        </Text>
      ) : null}

      <View className="flex-row items-center gap-2">
        <Button
          variant="default"
          size="sm"
          accessibilityLabel={isCreate ? 'Create pack' : 'Save'}
          disabled={saveDisabled}
          onPress={onSave}
        >
          <Text>{saving ? 'Saving…' : isCreate ? 'Create pack' : 'Save'}</Text>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          accessibilityLabel="Cancel"
          disabled={saving}
          onPress={onBack}
        >
          <Text>Cancel</Text>
        </Button>
      </View>

      {packId !== undefined ? (
        <View className="gap-2 border-t border-divider pt-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete ${title === '' ? 'pack' : title}`}
            disabled={saving}
            onPress={onAskDelete}
            className="h-11 flex-row items-center justify-center gap-2 rounded-full border border-danger disabled:opacity-60"
          >
            <Trash2 size={16} color={DANGER} />
            <Text className="text-[15px] font-medium text-danger">Delete pack</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

function PackVisibilityField({
  value,
  disabled,
  imported,
  onChange,
}: {
  value: PackVisibility;
  disabled: boolean;
  imported: boolean;
  onChange: (next: PackVisibility) => void;
}) {
  return (
    <View className="gap-2">
      <SegmentedControl
        mode="radio"
        accessibilityLabel="Who can find this pack"
        options={[
          { value: 'private', label: 'Private', icon: Lock, disabled },
          { value: 'server', label: 'Shared', icon: Globe, disabled },
        ]}
        value={value}
        onChange={(next) => onChange(next === 'server' ? 'server' : 'private')}
      />
      {imported ? (
        <Text className="text-[13px] text-muted-foreground">
          Imported packs are for personal use, so they stay private and cannot be shared.
        </Text>
      ) : null}
    </View>
  );
}

/** Edit order on Save: patch title/visibility, then deletions, then uploads one by one (web order). */
export default function StickerPackScreen() {
  return (
    <RequireStickersAuth>
      <StickerPackBody />
    </RequireStickersAuth>
  );
}

const LOAD_ERROR = 'Could not load this pack.';
const NOT_FOUND = 'This pack was not found.';
const FORBIDDEN = 'You can only edit your own packs.';

export type StickerPackScreenDeps = PackEditorDeps;

function StickerPackBody({ picker, preparer }: StickerPackScreenDeps) {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const editor = usePackEditor({ picker, preparer });
  const tile = favoriteTileSize(windowWidth);
  const [selection, setSelection] = useState<PackTileSelection | null>(null);

  return (
    <SettingsScreenShell
      title={editor.packId === undefined ? 'New pack' : 'Edit pack'}
      onBack={editor.onBack}
    >
      {editor.status === 'loading' ? <StateMessage kind="loading" title="Loading pack…" /> : null}

      {editor.status === 'load-error' ? (
        <StateMessage
          kind="error"
          title={LOAD_ERROR}
          action={{
            label: 'Retry',
            accessibilityLabel: 'Retry loading pack',
            onPress: editor.load,
          }}
        />
      ) : null}

      {editor.status === 'not-found' || editor.status === 'forbidden' ? (
        <View className="items-center gap-3 pt-12">
          <Text accessibilityRole="alert" className="text-center text-[15px] text-danger">
            {editor.status === 'not-found' ? NOT_FOUND : FORBIDDEN}
          </Text>
          <Button
            variant="outline"
            size="sm"
            accessibilityLabel="Back to stickers"
            onPress={() => router.back()}
          >
            <Text>Back to stickers</Text>
          </Button>
        </View>
      ) : null}

      {editor.status === 'ready' ? (
        <View className="gap-5">
          <View className="gap-1">
            <Text className="text-[14px] font-medium text-foreground">Pack name</Text>
            <TextField
              value={editor.title}
              onChangeText={editor.setTitle}
              maxLength={60}
              placeholder="My stickers"
              accessibilityLabel="Pack name"
              returnKeyType="done"
              editable={!editor.saving}
              className="h-11"
              style={editor.saving ? { opacity: 0.6 } : undefined}
            />
          </View>

          <PackVisibilityField
            value={editor.visibility}
            disabled={editor.visibilityDisabled}
            imported={editor.imported}
            onChange={editor.setVisibility}
          />

          <View className="gap-2">
            <View className="flex-row items-baseline justify-between">
              <Text className="text-[16px] font-semibold text-foreground">Stickers</Text>
              <Text className="font-mono text-[13px] text-muted-foreground">
                {editor.count} / {MAX_PACK_STICKERS}
              </Text>
            </View>
            <PackGrid
              visibleSaved={editor.visibleSaved}
              fresh={editor.fresh}
              preparing={editor.preparing}
              tile={tile}
              token={editor.token}
              saving={editor.saving}
              packFull={editor.packFull}
              onPickImages={editor.pickImages}
              onSelect={setSelection}
            />
            {editor.skippedNote ? (
              <Text className="text-[13px] text-muted-foreground">
                Only 120 stickers fit in a pack. Extra images were skipped.
              </Text>
            ) : null}
          </View>

          <PackTileSheet
            selection={selection}
            visibleSaved={editor.visibleSaved}
            fresh={editor.fresh}
            token={editor.token}
            saving={editor.saving}
            onClose={() => setSelection(null)}
            onChangeEmoji={editor.changeEmoji}
            onRetry={editor.retryItem}
            onRemoveSaved={(stickerId) => {
              setSelection(null);
              editor.removeSaved(stickerId);
            }}
            onRemoveFresh={(key) => {
              setSelection(null);
              editor.removeFresh(key);
            }}
          />

          <PackActions
            saving={editor.saving}
            progress={editor.progress}
            formError={editor.formError}
            isCreate={editor.isCreate}
            saveDisabled={editor.saveDisabled}
            packId={editor.packId}
            title={editor.title}
            onSave={editor.save}
            onBack={editor.onBack}
            onAskDelete={editor.askDelete}
          />
        </View>
      ) : null}

      <ConfirmDialog
        visible={editor.confirmingDelete}
        title="Delete this pack?"
        message="The pack and its files are deleted. Messages already sent keep their sticker URL, which no longer loads a sticker."
        error={editor.deleteError}
        confirmLabel="Delete"
        busyLabel="Deleting…"
        busy={editor.deleting}
        onCancel={editor.cancelDelete}
        onConfirm={editor.confirmDelete}
        confirmAccessibilityLabel={editor.title === '' ? 'Delete pack' : `Delete ${editor.title}`}
        destructive
      />

      <ConfirmDialog
        visible={editor.discardAsk}
        title="Discard changes?"
        message="Your changes to this pack are not saved."
        confirmLabel="Discard"
        busyLabel="Discard"
        busy={false}
        onCancel={editor.keepEditing}
        onConfirm={editor.discard}
        cancelLabel="Keep editing"
        cancelAccessibilityLabel="Keep editing"
        destructive
      />
    </SettingsScreenShell>
  );
}

type PackTileSelection = { kind: 'saved'; stickerId: string } | { kind: 'fresh'; key: string };

/**
 * A moving file (GIF, video, animated WebP or APNG) keeps its bytes and reports
 * `width: 0, height: 0`, so its first frame is shown with a repeat badge. A
 * failed row reports the same zeros, so the error is checked first.
 */
function isMoving(item: EditorNewItem): boolean {
  return item.width === 0 && item.height === 0;
}

const TILE =
  'items-center justify-center overflow-hidden rounded-[12px] border border-edge bg-surface';

function freshLabel(item: EditorNewItem, position: number): string {
  if (item.error !== undefined) {
    return item.error;
  }
  return item.emoji === '' ? `Sticker ${position}` : item.emoji;
}

function EmojiBadge({ emoji }: { emoji: string }) {
  return (
    <View className="absolute bottom-1 right-1 h-5 w-5 items-center justify-center rounded-full border border-border bg-background">
      {emoji === '' ? (
        <Smile size={11} color={MUTED_FOREGROUND} accessibilityLabel="No emoji" />
      ) : (
        <Text numberOfLines={1} className="text-[11px] text-foreground">
          {emoji}
        </Text>
      )}
    </View>
  );
}

function PackGrid({
  visibleSaved,
  fresh,
  preparing,
  tile,
  token,
  saving,
  packFull,
  onPickImages,
  onSelect,
}: {
  visibleSaved: StickerItem[];
  fresh: EditorNewItem[];
  preparing: number;
  tile: number;
  token: string | undefined;
  saving: boolean;
  packFull: boolean;
  onPickImages: () => void;
  onSelect: (selection: PackTileSelection) => void;
}) {
  return (
    <View accessibilityLabel="Stickers in this pack" className="flex-row flex-wrap gap-2">
      {visibleSaved.map((sticker, index) => (
        <Pressable
          key={sticker.id}
          accessibilityRole="button"
          accessibilityLabel={sticker.emoji === null ? `Sticker ${index + 1}` : sticker.emoji}
          onPress={() => onSelect({ kind: 'saved', stickerId: sticker.id })}
          className={cn(TILE, 'active:opacity-70')}
          style={{ width: tile, height: tile }}
        >
          {isSameOriginStickerUrl(sticker.url, API_URL) ? (
            <Image
              source={stickerImageSource(sticker.url, API_URL, token)}
              style={{ width: tile - 8, height: tile - 8 }}
              contentFit="contain"
            />
          ) : null}
          {sticker.emoji === null ? null : <EmojiBadge emoji={sticker.emoji} />}
        </Pressable>
      ))}

      {fresh.map((item, index) => (
        <Pressable
          key={item.key}
          accessibilityRole="button"
          accessibilityLabel={freshLabel(item, visibleSaved.length + index + 1)}
          onPress={() => onSelect({ kind: 'fresh', key: item.key })}
          className={cn(TILE, item.error === undefined ? undefined : 'border-danger/60')}
          style={{ width: tile, height: tile }}
        >
          {item.error === undefined ? (
            <>
              <Image
                source={{ uri: item.uri }}
                style={{ width: tile - 8, height: tile - 8 }}
                contentFit="contain"
              />
              {isMoving(item) ? (
                <View
                  accessible
                  accessibilityLabel="Moves"
                  className="absolute left-1 top-1 h-[18px] w-[18px] items-center justify-center rounded-[6px] bg-black/85"
                >
                  <Repeat size={11} color={FOREGROUND} />
                </View>
              ) : null}
              <EmojiBadge emoji={item.emoji} />
            </>
          ) : (
            <TriangleAlert size={22} color={DANGER} />
          )}
        </Pressable>
      ))}

      {Array.from({ length: preparing }, (_, index) => (
        <View key={`preparing-${index}`} className={TILE} style={{ width: tile, height: tile }}>
          <ActivityIndicator accessibilityLabel="Preparing" color={MUTED_FOREGROUND} />
        </View>
      ))}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add photos, GIFs or videos"
        disabled={saving || preparing > 0 || packFull}
        onPress={onPickImages}
        className="items-center justify-center gap-1 rounded-[12px] border border-dashed border-border-strong disabled:opacity-60"
        style={{ width: tile, height: tile }}
      >
        <Plus size={22} color={MUTED_FOREGROUND} />
        <Text className="text-[12px] text-muted-foreground">Add</Text>
      </Pressable>
    </View>
  );
}
