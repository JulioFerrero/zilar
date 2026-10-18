import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';

type ChannelMoreMenuProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  busy: boolean;
  error: string;
  onDelete: () => void;
};

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
