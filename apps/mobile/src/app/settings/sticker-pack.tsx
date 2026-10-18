import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { RequireStickersAuth } from '@/components/stickers/require-stickers-auth';
import { PackActions } from '@/components/stickers/pack-actions';
import { MAX_PACK_STICKERS } from '@/components/stickers/pack-editor';
import { PackGrid, type PackTileSelection } from '@/components/stickers/pack-grid';
import { PackTileSheet } from '@/components/stickers/pack-tile-sheet';
import { PackVisibilityField } from '@/components/stickers/pack-visibility-field';
import { usePackEditor, type PackEditorDeps } from '@/components/stickers/use-pack-editor';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { favoriteTileSize } from './stickers';

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
