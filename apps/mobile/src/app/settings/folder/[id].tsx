import {
  FOLDER_ICONS,
  FOLDERS_MAX,
  FOLDER_NAME_MAX,
  type FolderChatType,
  type FolderIcon,
} from '@zilar/chat-core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useState } from 'react';
import { Pressable, Switch, TextInput, View } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { folderIcon } from '@/components/chat/folder-icon';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { FOLDER_TYPE_LABELS, folderInput, isFolderNameValid } from '@/components/settings/folders';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { ChatFoldersApiError } from '@/lib/chat-folders-api';
import { asColorScheme } from '@/lib/color-scheme';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { iconKey } from '@/lib/depth';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/chat-store-provider';

const TYPE_ORDER: FolderChatType[] = ['dm', 'group', 'channel', 'ai'];

/**
 * Settings → Chat folders → editor (T-0255, mirrors the web
 * `FolderEditorDialog`): name and icon, the chat types to show, what to hide,
 * and — for an existing folder — an inline delete confirm. `id` is `new` for a
 * new folder. The single-chat pickers are a later task; a folder's existing
 * include/exclude chat lists are left untouched.
 */
export default function FolderEditorScreen() {
  return (
    <RequireAuth>
      <FolderEditor />
    </RequireAuth>
  );
}

function FolderEditor() {
  const router = useRouter();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const folder = useChatStore((state) =>
    id === undefined || id === 'new' ? undefined : state.folders.find((entry) => entry.id === id),
  );
  const createFolder = useChatStore((state) => state.createFolder);
  const updateFolder = useChatStore((state) => state.updateFolder);
  const deleteFolder = useChatStore((state) => state.deleteFolder);

  const [name, setName] = useState(folder?.name ?? '');
  const [icon, setIcon] = useState<FolderIcon>(folder?.icon ?? 'folder');
  const [includeTypes, setIncludeTypes] = useState<FolderChatType[]>(folder?.includeTypes ?? []);
  const [excludeMuted, setExcludeMuted] = useState(folder?.excludeMuted ?? false);
  const [excludeRead, setExcludeRead] = useState(folder?.excludeRead ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isNew = id === undefined || id === 'new';
  const canSave = isFolderNameValid(name) && !busy;

  const toggleType = (type: FolderChatType): void => {
    setIncludeTypes((types) =>
      types.includes(type) ? types.filter((entry) => entry !== type) : [...types, type],
    );
  };

  const save = (): void => {
    if (!canSave || id === undefined) {
      return;
    }
    const input = folderInput({ name, icon, includeTypes, excludeMuted, excludeRead });
    setBusy(true);
    setError('');
    const request = id === 'new' ? createFolder(input) : updateFolder(id, input);
    request
      .then(() => router.back())
      .catch((saveError: unknown) => setError(folderSaveError(saveError)))
      .finally(() => setBusy(false));
  };

  const remove = (): void => {
    if (isNew || id === undefined || busy) {
      return;
    }
    setBusy(true);
    setError('');
    deleteFolder(id)
      .then(() => router.back())
      .catch(() => {
        setConfirmingDelete(false);
        setError('Could not delete the folder. Try again.');
      })
      .finally(() => setBusy(false));
  };

  return (
    <SettingsScreenShell
      title={isNew ? 'New folder' : 'Edit folder'}
      onBack={() => router.back()}
      right={
        <Button size="sm" disabled={!canSave} onPress={save} accessibilityLabel="Save folder">
          <Text>{busy ? 'Saving…' : 'Save'}</Text>
        </Button>
      }
    >
      <View className="gap-4">
        <View className="gap-3 rounded-xl border border-border bg-surface px-3 py-3">
          <Text className="text-[16px] font-semibold text-foreground">Name and icon</Text>
          <View className="flex-row items-center gap-2 rounded-lg border border-input bg-background px-3 py-2">
            <TextInput
              accessibilityLabel="Folder name"
              maxLength={FOLDER_NAME_MAX}
              editable={!busy}
              value={name}
              onChangeText={setName}
              placeholder="Folder name"
              placeholderTextColor={MUTED_FOREGROUND[scheme]}
              className="min-w-0 flex-1 text-[15px] text-foreground"
            />
            <Text className="text-[13px] tabular-nums text-muted-foreground">
              {name.length}/{FOLDER_NAME_MAX}
            </Text>
          </View>
          <View className="flex-row flex-wrap">
            {FOLDER_ICONS.map((iconName) => {
              const Icon = folderIcon(iconName);
              const selected = icon === iconName;
              return (
                <Pressable
                  key={iconName}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={iconName}
                  disabled={busy}
                  onPress={() => setIcon(iconName)}
                  style={{ width: '16.6667%' }}
                  className="items-center justify-center p-1"
                >
                  <View
                    style={selected ? iconKey : undefined}
                    className={cn(
                      'items-center justify-center rounded-xl p-2',
                      selected ? '' : 'border border-transparent',
                    )}
                  >
                    <Icon size={18} color={selected ? ICON[scheme] : MUTED_FOREGROUND[scheme]} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="gap-3 rounded-xl border border-border bg-surface px-3 py-3">
          <Text className="text-[16px] font-semibold text-foreground">Show these chats</Text>
          {TYPE_ORDER.map((type) => (
            <SwitchRow
              key={type}
              label={FOLDER_TYPE_LABELS[type]}
              value={includeTypes.includes(type)}
              disabled={busy}
              onValueChange={() => toggleType(type)}
            />
          ))}
        </View>

        <View className="gap-3 rounded-xl border border-border bg-surface px-3 py-3">
          <Text className="text-[16px] font-semibold text-foreground">Hide</Text>
          <SwitchRow
            label="Muted chats"
            value={excludeMuted}
            disabled={busy}
            onValueChange={setExcludeMuted}
          />
          <SwitchRow
            label="Read chats"
            value={excludeRead}
            disabled={busy}
            onValueChange={setExcludeRead}
          />
        </View>

        {error !== '' ? (
          <Text accessibilityRole="alert" className="text-[14px] text-danger">
            {error}
          </Text>
        ) : null}

        {!isNew ? (
          <View className="rounded-xl border border-border bg-surface px-3 py-3">
            {confirmingDelete ? (
              <View className="gap-3">
                <Text className="text-[15px] leading-5 text-foreground">
                  {`Delete the folder ${folder?.name ?? name}? Chats stay where they are.`}
                </Text>
                <View className="flex-row justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onPress={() => setConfirmingDelete(false)}
                  >
                    <Text>Cancel</Text>
                  </Button>
                  <Button variant="destructive" size="sm" disabled={busy} onPress={remove}>
                    <Text>{busy ? 'Deleting…' : 'Delete'}</Text>
                  </Button>
                </View>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete folder"
                onPress={() => setConfirmingDelete(true)}
                className="items-center py-1"
              >
                <Text className="text-[15px] font-medium text-danger">Delete folder</Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </View>
    </SettingsScreenShell>
  );
}

function SwitchRow({
  label,
  value,
  disabled,
  onValueChange,
}: {
  label: string;
  value: boolean;
  disabled: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <Text className="min-w-0 flex-1 text-[15px] text-foreground">{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
      />
    </View>
  );
}

function folderSaveError(error: unknown): string {
  if (error instanceof ChatFoldersApiError) {
    if (error.code === 'folder_limit') {
      return `You can have up to ${FOLDERS_MAX} folders.`;
    }
    if (error.code === 'rate_limited') {
      return 'Too many changes. Wait a moment.';
    }
  }
  return 'Could not save the folder. Try again.';
}
