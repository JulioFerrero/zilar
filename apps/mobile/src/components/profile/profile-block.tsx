import { Ban } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { shouldResetBlockConfirm } from '@/components/contacts/profile-card';
import type { ContactRelation } from '@/lib/contacts-api';

type ProfileBlockProps = {
  userId: string;
  name: string;
  relation: ContactRelation;
  busy: boolean;
  onBlock: () => void;
  onUnblock: () => void;
};

/**
 * The Block / Unblock row at the bottom of the profile (T-1308), in the
 * destructive red token. Block keeps the app's inline confirm (the card's
 * `shouldResetBlockConfirm` rule drops a stale confirm when the person or the
 * relation changes, e.g. right after a successful block).
 */
export function ProfileBlock({
  userId,
  name,
  relation,
  busy,
  onBlock,
  onUnblock,
}: ProfileBlockProps) {
  const [confirming, setConfirming] = useState(false);
  const [last, setLast] = useState({ userId, relation });
  if (shouldResetBlockConfirm(last, { userId, relation })) {
    setLast({ userId, relation });
    setConfirming(false);
  }

  if (relation === 'self') {
    return null;
  }

  if (relation === 'blocked') {
    return (
      <Button
        accessibilityLabel="Unblock"
        disabled={busy}
        onPress={onUnblock}
        variant="outline"
        size="default"
        className="self-center rounded-full px-6"
      >
        <Text>{busy ? 'Unblocking…' : 'Unblock'}</Text>
      </Button>
    );
  }

  if (confirming) {
    return (
      <View className="rounded-xl bg-surface-raised px-3 py-2.5">
        <Text className="text-[14px] leading-5 text-foreground">
          Block {name}? They are not told. You won&apos;t see their contact requests.
        </Text>
        <View className="mt-2 flex-row gap-2">
          <Button
            variant="destructive"
            size="sm"
            accessibilityLabel="Confirm block"
            disabled={busy}
            onPress={onBlock}
          >
            <Ban size={14} color="#ffffff" />
            <Text>{busy ? 'Blocking…' : 'Block'}</Text>
          </Button>
          <Button
            accessibilityLabel="Cancel the block"
            disabled={busy}
            onPress={() => setConfirming(false)}
            variant="outline"
            size="sm"
          >
            <Text>Cancel</Text>
          </Button>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Block"
      disabled={busy}
      onPress={() => setConfirming(true)}
      className="items-center rounded-xl border border-border bg-surface px-3 py-3 active:bg-surface-raised"
    >
      <Text className="text-[15px] font-medium text-danger">Block</Text>
    </Pressable>
  );
}
