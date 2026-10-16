import { canAct, canDeleteMessage, type UiMessage } from '@zilar/chat-core';
import { Effect } from 'effect';
import * as Clipboard from 'expo-clipboard';
import { Copy, Forward, Trash2, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SelectionDeleteConfirm } from '@/components/chat/selection-delete';
import { useBackCancel } from '@/components/chat/use-back-cancel';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { DANGER, ICON } from '@/lib/colors';
import { useChatStore } from '@/store/chat-store-provider';

const EMPTY_MESSAGES: UiMessage[] = [];

/** Which delete action one selected message allows, mirroring web's SelectionBar. */
function deleteActionFor(
  message: UiMessage,
  meId: string,
  isDm: boolean,
): 'everyone' | 'me' | 'none' {
  if (message.status === 'sending') {
    return 'none';
  }
  if (canDeleteMessage(message, meId)) {
    return 'everyone';
  }
  return isDm && message.deleted !== true ? 'me' : 'none';
}

/**
 * The bar shown while several messages are selected (T-0445): "N selected",
 * Cancel, Delete, Copy and Forward. Delete and Copy follow the single-message
 * rules (T-1666/WUX-32); Android back leaves select mode, or closes the open
 * confirm instead.
 */
export function SelectionBar({
  chat,
  selectedIds,
  onForward,
  onCancel,
}: {
  chat: { id: string; kind: string; isAI?: boolean };
  /** The checked message ids, in the order they were checked. */
  selectedIds: string[];
  onForward: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const meId = useChatStore((state) => state.currentUserId);
  const stored = useChatStore((state) => state.messagesByChat[chat.id]);
  const deleteForMe = useChatStore((state) => state.deleteForMe);
  const deleteForEveryone = useChatStore((state) => state.deleteForEveryone);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const selected = useMemo(() => {
    const ids = new Set(selectedIds);
    return (stored ?? EMPTY_MESSAGES).filter((message) => ids.has(message.id));
  }, [stored, selectedIds]);

  const isDm = chat.kind === 'dm' && chat.isAI !== true;
  const deletable = useMemo(
    () =>
      selected.filter(
        (message) => deleteActionFor(message, meId, isDm) !== 'none' && canAct(message),
      ),
    [selected, meId, isDm],
  );
  // "Delete for everyone" is offered only when every deletable message is mine;
  // a DM selection holding a peer's message can only be deleted for me.
  const allMine = deletable.every((message) => message.senderId === meId);
  const copyable = selected.filter(
    (message) => message.deleted !== true && (message.text ?? '').length > 0,
  );

  useBackCancel(() => {
    if (confirmOpen) {
      setConfirmOpen(false);
      return;
    }
    onCancel();
  });

  const copySelected = (): void => {
    Effect.runFork(
      Effect.tryPromise(() =>
        Clipboard.setStringAsync(
          copyable.map((message) => `${message.senderName}: ${message.text ?? ''}`).join('\n'),
        ),
      ).pipe(Effect.ignore),
    );
    onCancel();
  };

  const deleteForMeOnAll = (): void => {
    for (const message of deletable) {
      void deleteForMe(chat.id, message.id);
    }
  };
  const deleteForEveryoneOnAll = (): void => {
    for (const message of deletable) {
      deleteForEveryone(chat.id, message.id);
    }
  };

  const count = selectedIds.length;

  return (
    <View className="px-2 pt-1.5" style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
      <View className="flex-row items-center gap-2 rounded-[14px] bg-surface-raised px-4 py-2.5">
        <IconButton label="Cancel" onPress={onCancel}>
          <X size={20} color={ICON} />
        </IconButton>
        <Text
          accessibilityLiveRegion="polite"
          numberOfLines={1}
          className="min-w-0 flex-1 text-[14px] text-muted-foreground"
        >
          {count} selected
        </Text>
        {deletable.length > 0 ? (
          <IconButton label="Delete selected messages" onPress={() => setConfirmOpen(true)}>
            <Trash2 size={20} color={DANGER} />
          </IconButton>
        ) : null}
        <IconButton
          label="Copy selected messages"
          disabled={copyable.length === 0}
          className={copyable.length === 0 ? 'opacity-50' : undefined}
          onPress={copySelected}
        >
          <Copy size={20} color={ICON} />
        </IconButton>
        <Button disabled={count === 0} onPress={onForward}>
          <Forward size={16} />
          <Text>Forward</Text>
        </Button>
      </View>
      <SelectionDeleteConfirm
        visible={confirmOpen}
        deletable={deletable}
        isDm={isDm}
        allMine={allMine}
        onCancel={() => setConfirmOpen(false)}
        onDeleteForMe={() => {
          setConfirmOpen(false);
          deleteForMeOnAll();
          onCancel();
        }}
        onDeleteForEveryone={() => {
          setConfirmOpen(false);
          deleteForEveryoneOnAll();
          onCancel();
        }}
      />
    </View>
  );
}
