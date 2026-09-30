import { Modal, Pressable, View } from 'react-native';

import { Text } from '../ui/text';
import { pinLabel, type SnapshotPinKind } from '../../lib/pin-snapshot';

/** The pin fields the sheet reads (the store's `Pin` is assignable). */
export interface SheetPin {
  id: string;
  messageId: string;
  senderName: string;
  text: string;
  kind: SnapshotPinKind;
}

/**
 * The pins list sheet (T-0135, the mobile twin of the web `PinsPanel`):
 * every pin with jump, and Unpin for people who may pin (disabled per row
 * while its unpin is in flight). Reachable from the banner's list button.
 *
 * Pure view (no hooks) so it stays render-testable like `ReactionChips`:
 * the screen subscribes the pins and owns the unpin flight.
 */
export function PinsSheet({
  open,
  pins,
  canUnpin,
  unpinningId,
  error,
  onUnpin,
  onJump,
  onClose,
}: {
  open: boolean;
  pins: SheetPin[];
  canUnpin: boolean;
  unpinningId: string | null;
  error: string;
  onUnpin: (pin: SheetPin) => void;
  onJump: (pin: SheetPin) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close pins list"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40"
      >
        <Pressable
          onPress={() => {}}
          className="max-h-[70%] rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3"
          style={{ paddingBottom: 16 }}
        >
          <View className="mb-1 h-1 w-10 self-center rounded-full bg-surface-raised" />
          <Text
            accessibilityRole="header"
            className="py-2 text-[17px] font-semibold text-foreground"
          >
            Pinned messages ({pins.length})
          </Text>
          {pins.map((pin) => {
            const unpinning = unpinningId === pin.id;
            return (
              <View
                key={pin.id}
                className="flex-row items-center gap-2 border-t border-divider py-2"
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Jump to pinned message from ${pin.senderName}`}
                  onPress={() => {
                    onClose();
                    onJump(pin);
                  }}
                  className="min-w-0 flex-1 active:opacity-70"
                >
                  <Text numberOfLines={1} className="text-[13px] text-foreground">
                    <Text className="font-semibold">{pin.senderName}: </Text>
                    {pinLabel(pin)}
                  </Text>
                </Pressable>
                {canUnpin ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Unpin message from ${pin.senderName}`}
                    disabled={unpinning}
                    onPress={() => onUnpin(pin)}
                    className="shrink-0 rounded-full px-3 py-1.5 active:bg-surface-raised disabled:opacity-50"
                  >
                    <Text className="text-[13px] font-medium text-danger">
                      {unpinning ? '…' : 'Unpin'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          {pins.length === 0 ? (
            <Text className="py-3 text-center text-[14px] text-muted-foreground">
              No pinned messages.
            </Text>
          ) : null}
          {error !== '' ? (
            <Text accessibilityRole="alert" className="py-1 text-[13px] text-danger">
              {error}
            </Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
