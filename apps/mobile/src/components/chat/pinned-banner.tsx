import { Pin } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Button } from '../ui/button';
import { Text } from '../ui/text';
import { pinLabel, type SnapshotPinKind } from '../../lib/pin-snapshot';

/** The pin fields the banner reads (the store's `Pin` is assignable). */
export interface BannerPin {
  id: string;
  messageId: string;
  senderName: string;
  text: string;
  kind: SnapshotPinKind;
}

/**
 * The pinned-message banner under the chat header (T-0135, the mobile twin
 * of the web `PinnedBanner`): the latest pin's sender and snapshot text (or
 * a kind label for attachments), tap to jump to it when it is loaded, "n
 * pins" opens the list sheet. With several pins the banner cycles ("1 of
 * N"). A retracted original whose retraction the client has seen reads
 * "Message deleted" (the snapshot says so). Pin load failures surface here
 * with a dismiss key; a jump at a message that is not loaded shows
 * "Message not found" (mobile has no history paging yet).
 *
 * Pure view (no hooks) so it stays render-testable like `ReactionChips`:
 * the screen owns the pins subscription, the cycle index and the jump.
 */
export function PinnedBanner({
  pins,
  pinsError,
  index,
  jumpError,
  onCycle,
  onTapPin,
  onOpenList,
  onDismissError,
}: {
  pins: BannerPin[];
  pinsError: string | undefined;
  index: number;
  jumpError: string;
  onCycle: () => void;
  onTapPin: (pin: BannerPin) => void;
  onOpenList: () => void;
  onDismissError: () => void;
}) {
  if (pins.length === 0) {
    if (pinsError === undefined && jumpError === '') {
      return null;
    }
    return (
      <View className="border-b border-divider bg-surface px-4 py-2">
        {pinsError !== undefined ? (
          <View className="flex-row items-center justify-between gap-2">
            <Text accessibilityRole="alert" className="flex-1 text-[12px] text-danger">
              {pinsError}
            </Text>
            <Button
              variant="ghost"
              size="sm"
              accessibilityLabel="Dismiss pins error"
              onPress={onDismissError}
              className="h-7 rounded-full px-2"
            >
              <Text className="text-[12px] text-muted-foreground">Dismiss</Text>
            </Button>
          </View>
        ) : null}
        {jumpError !== '' ? (
          <Text accessibilityRole="alert" className="text-center text-[12px] text-danger">
            {jumpError}
          </Text>
        ) : null}
      </View>
    );
  }

  const current = pins[Math.min(index, pins.length - 1)] ?? pins[0]!;
  const label = pinLabel(current);

  return (
    <View className="border-b border-divider bg-surface px-3 py-1.5">
      {pinsError !== undefined ? (
        <View className="flex-row items-center justify-between gap-2 pb-1">
          <Text accessibilityRole="alert" className="flex-1 text-[12px] text-danger">
            {pinsError}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            accessibilityLabel="Dismiss pins error"
            onPress={onDismissError}
            className="h-7 rounded-full px-2"
          >
            <Text className="text-[12px] text-muted-foreground">Dismiss</Text>
          </Button>
        </View>
      ) : null}
      <View className="flex-row items-center gap-2">
        <Pin size={14} color="#8a8a8a" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Jump to pinned message from ${current.senderName}`}
          onPress={() => onTapPin(current)}
          className="min-w-0 flex-1 active:opacity-70"
        >
          <Text numberOfLines={1} className="text-[13px] text-foreground">
            <Text className="font-semibold">{current.senderName}: </Text>
            {label}
          </Text>
        </Pressable>
        {pins.length > 1 ? (
          <Button
            variant="ghost"
            size="sm"
            accessibilityLabel={`Cycle pins, ${index + 1} of ${pins.length}`}
            onPress={onCycle}
            className="shrink-0 h-7 rounded-full px-2"
          >
            <Text className="text-[12px] font-medium text-muted-foreground">
              {index + 1} of {pins.length}
            </Text>
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          accessibilityLabel={
            pins.length === 1 ? 'Show pinned message' : `Show all pins, ${pins.length}`
          }
          onPress={onOpenList}
          className="shrink-0 h-7 rounded-full px-2"
        >
          <Text className="text-[12px] font-medium text-muted-foreground">
            {pins.length === 1 ? 'Pin' : `${pins.length} pins`}
          </Text>
        </Button>
      </View>
      {jumpError !== '' ? (
        <Text accessibilityRole="alert" className="mt-0.5 text-[12px] text-danger">
          {jumpError}
        </Text>
      ) : null}
    </View>
  );
}
