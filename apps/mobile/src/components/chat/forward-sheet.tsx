import type { UiMessage } from '@zilar/chat-core';
import { useState } from 'react';
import { View } from 'react-native';

import { ChatPickerList } from '@/components/chat/chat-picker-list';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { useChatStore } from '@/store/chat-store-provider';

export { forwardTargets } from '@/components/chat/chat-picker-list';

/** `Send`, or `Send to N chats` once more than one target is picked. */
export function forwardSendLabel(count: number): string {
  return count > 1 ? `Send to ${count} chats` : 'Send';
}

/**
 * Picks one or more target chats for a forward (T-F part 2, T-0435): the same
 * flow as web's `ForwardPicker`, on a mobile bottom sheet. Several targets are
 * allowed; the optional comment rides along as a separate message per target
 * (the store action already splits it).
 */
export function ForwardSheet({
  messages,
  onClose,
}: {
  messages: UiMessage[];
  onClose: () => void;
}) {
  const chats = useChatStore((state) => state.chats);
  const forwardMessages = useChatStore((state) => state.forwardMessages);
  const [selected, setSelected] = useState<string[]>([]);
  const [comment, setComment] = useState('');

  const toggle = (chatId: string): void => {
    setSelected((current) =>
      current.includes(chatId) ? current.filter((id) => id !== chatId) : [...current, chatId],
    );
  };

  const send = (): void => {
    if (selected.length === 0) {
      return;
    }
    const trimmed = comment.trim();
    forwardMessages(selected, messages, trimmed === '' ? undefined : { comment: trimmed });
    onClose();
  };

  return (
    <BottomSheet
      visible
      onClose={onClose}
      closeLabel="Close forward"
      title="Forward"
      footer={
        <Button disabled={selected.length === 0} onPress={send}>
          <Text>{forwardSendLabel(selected.length)}</Text>
        </Button>
      }
    >
      <ChatPickerList chats={chats} selected={selected} onToggle={toggle} mode="multi" />
      <View className="mt-3">
        <TextField
          label="Add a comment (optional)"
          value={comment}
          onChangeText={setComment}
          multiline
        />
      </View>
    </BottomSheet>
  );
}
