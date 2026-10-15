import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';

type ChannelMoreMenuProps = {
  /** The owner's More key opened the menu. */
  open: boolean;
  onClose: () => void;
  /** The channel name: the typed-name gate and the confirm copy. */
  title: string;
  busy: boolean;
  error: string;
  onDelete: () => void;
};

/**
 * The owner's More menu for a channel (T-1587), after web's channel root: an
 * action sheet holding Delete channel, which opens the same typed-name
 * confirmation the group uses, worded for a channel. The screen runs the
 * delete and the navigation; this holds only the local menu/confirm state.
 */
export function ChannelMoreMenu({
  open,
  onClose,
  title,
  busy,
  error,
  onDelete,
}: ChannelMoreMenuProps) {
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteName, setDeleteName] = useState('');

  const closeDelete = () => {
    if (!busy) {
      setDeleteOpen(false);
      setDeleteName('');
    }
  };

  return (
    <>
      <ActionSheet
        visible={open}
        onClose={onClose}
        onDismissed={() => {
          if (pendingDelete) {
            setPendingDelete(false);
            setDeleteOpen(true);
          }
        }}
        closeLabel="Close more actions"
      >
        <ActionSheetItem
          label="Delete channel"
          icon={Trash2}
          destructive
          onPress={() => {
            setPendingDelete(true);
            onClose();
          }}
        />
      </ActionSheet>

      <BottomSheet
        visible={deleteOpen}
        onClose={closeDelete}
        closeLabel="Close delete channel"
        title="Delete channel"
        footer={
          <Button
            variant="destructive"
            accessibilityLabel="Delete channel"
            disabled={busy || deleteName.trim() !== title}
            onPress={onDelete}
          >
            <Text>{busy ? 'Deleting…' : 'Delete channel'}</Text>
          </Button>
        }
      >
        <Text className="text-[13px] leading-5 text-muted-foreground">
          Delete {title} for everyone? The channel and its messages go away. This can&apos;t be
          undone.
        </Text>
        <View className="mt-3">
          <TextField
            value={deleteName}
            onChangeText={setDeleteName}
            placeholder={title}
            accessibilityLabel="Type the channel name to confirm"
          />
        </View>
        {error !== '' ? (
          <Text accessibilityRole="alert" className="pt-2 text-[13px] text-danger">
            {error}
          </Text>
        ) : null}
      </BottomSheet>
    </>
  );
}
