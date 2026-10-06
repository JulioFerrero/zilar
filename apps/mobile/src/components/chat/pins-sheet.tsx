import { Pressable, View } from 'react-native';

import { Text } from '../ui/text';
import { Button } from '../ui/button';
import { BottomSheet } from '../ui/bottom-sheet';
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
    <BottomSheet
      visible={open}
      onClose={onClose}
      closeLabel="Close pins list"
      title={`Pinned messages (${pins.length})`}
      maxHeightClassName="max-h-[70%]"
    >
      {pins.map((pin) => {
        const unpinning = unpinningId === pin.id;
        return (
          <View key={pin.id} className="flex-row items-center gap-2 border-t border-divider py-2">
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
              <Button
                variant="ghost"
                size="sm"
                accessibilityLabel={`Unpin message from ${pin.senderName}`}
                disabled={unpinning}
                onPress={() => onUnpin(pin)}
                className="shrink-0 rounded-full"
              >
                <Text className="text-[13px] font-medium text-danger">
                  {unpinning ? '…' : 'Unpin'}
                </Text>
              </Button>
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
    </BottomSheet>
  );
}
