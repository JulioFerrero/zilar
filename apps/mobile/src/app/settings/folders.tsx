import { FOLDERS_MAX, type ChatFolder, type FolderIcon } from '@zilar/chat-core';
import { useRouter } from 'expo-router';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useState } from 'react';
import { View } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { folderIcon } from '@/components/chat/folder-icon';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { folderSummary } from '@/components/settings/folders';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { IconTile } from '@/components/ui/icon-tile';
import { ListRow } from '@/components/ui/list-row';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { asColorScheme, type ColorScheme } from '@/lib/color-scheme';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { useChatStore } from '@/store/chat-store-provider';

/**
 * Settings → Chat folders (T-0255, mirrors the web `FoldersPage`): the list of
 * folders with per-row up/down reordering and a New folder row. Tapping a row
 * opens the editor. The chips on the Chats tab follow the store after every
 * write.
 */
export default function FoldersSettingsScreen() {
  return (
    <RequireAuth>
      <FoldersSettings />
    </RequireAuth>
  );
}

/** The lucide component for a folder icon; lowercase so it is not a component. */
function folderGlyph(icon: FolderIcon, color: string) {
  const Icon = folderIcon(icon);
  return <Icon size={18} color={color} />;
}

function FoldersSettings() {
  const router = useRouter();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const folders = useChatStore((state) => state.folders);
  const reorderFolders = useChatStore((state) => state.reorderFolders);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const atLimit = folders.length >= FOLDERS_MAX;

  const move = (id: string, direction: -1 | 1): void => {
    if (busy) {
      return;
    }
    const ids = folders.map((folder) => folder.id);
    const index = ids.indexOf(id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= ids.length) {
      return;
    }
    const next = [...ids];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) {
      return;
    }
    next.splice(target, 0, moved);
    setBusy(true);
    setError('');
    reorderFolders(next)
      .catch(() => setError('Could not reorder folders. Try again.'))
      .finally(() => setBusy(false));
  };

  const openFolder = (id: string): void => {
    router.push({ pathname: '/settings/folder/[id]', params: { id } });
  };

  return (
    <SettingsScreenShell
      title="Chat folders"
      subtitle="Sort chats into folders."
      onBack={() => router.back()}
    >
      {folders.length === 0 ? (
        <StateMessage kind="empty" size="inline" title="No folders yet." />
      ) : (
        <Card>
          {folders.map((folder, index) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              scheme={scheme}
              first={index === 0}
              last={index === folders.length - 1}
              busy={busy}
              onOpen={() => openFolder(folder.id)}
              onMoveUp={() => move(folder.id, -1)}
              onMoveDown={() => move(folder.id, 1)}
            />
          ))}
        </Card>
      )}

      <Button
        variant="outline"
        className="mt-3 rounded-xl border-dashed"
        accessibilityLabel="New folder"
        disabled={atLimit || busy}
        onPress={() => openFolder('new')}
      >
        <Plus size={18} color={MUTED_FOREGROUND[scheme]} />
        <Text className="text-[15px] font-medium text-foreground">New folder</Text>
      </Button>

      {atLimit ? (
        <Text className="mt-2 text-[14px] text-muted-foreground">
          You can have up to {FOLDERS_MAX} folders.
        </Text>
      ) : null}

      {error !== '' ? (
        <Text accessibilityRole="alert" className="mt-3 text-[14px] text-danger">
          {error}
        </Text>
      ) : null}
    </SettingsScreenShell>
  );
}

function FolderRow({
  folder,
  scheme,
  first,
  last,
  busy,
  onOpen,
  onMoveUp,
  onMoveDown,
}: {
  folder: ChatFolder;
  scheme: ColorScheme;
  first: boolean;
  last: boolean;
  busy: boolean;
  onOpen: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <View className="flex-row items-center gap-1 px-2 py-2">
      <IconButton
        label={`Move ${folder.name} up`}
        disabled={first || busy}
        onPress={onMoveUp}
        className="h-8 w-8"
      >
        <ChevronUp size={18} color={first || busy ? MUTED_FOREGROUND[scheme] : ICON[scheme]} />
      </IconButton>
      <IconButton
        label={`Move ${folder.name} down`}
        disabled={last || busy}
        onPress={onMoveDown}
        className="h-8 w-8"
      >
        <ChevronDown size={18} color={last || busy ? MUTED_FOREGROUND[scheme] : ICON[scheme]} />
      </IconButton>
      <ListRow
        className="min-w-0 flex-1 rounded-xl px-1 py-1"
        icon={
          <IconTile size={36} radius={12}>
            {folderGlyph(folder.icon, ICON[scheme])}
          </IconTile>
        }
        title={folder.name}
        subtitle={folderSummary(folder)}
        accessibilityLabel={`Edit ${folder.name}`}
        onPress={onOpen}
        disabled={busy}
      />
    </View>
  );
}
