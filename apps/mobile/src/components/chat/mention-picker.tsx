import { isAiJid, type MentionMember } from '@zilar/chat-core';
import { Pressable, View } from 'react-native';

import { AiBadge } from '@/components/chat/ai-badge';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text } from '@/components/ui/text';

export interface MentionPickerProps {
  members: MentionMember[];
  onSelect: (member: MentionMember) => void;
}

/**
 * The `@` member picker above a group composer (T-0227, the mobile twin of
 * web's `MentionPicker`). Rows are tapped (no hardware-key navigation on the
 * phone); the caller filters and caps the rows. Follows the board's phone
 * mention list (T-1842): 48 px rows, 30 px avatars and mono handles.
 */
export function MentionPicker({ members, onSelect }: MentionPickerProps) {
  return (
    <View
      accessibilityRole="list"
      accessibilityLabel="Mention someone"
      className="mb-2 overflow-hidden rounded-[16px] border border-[#1f1f1f] bg-[#111111] pt-1.5 pb-1.5"
      style={{ boxShadow: '0 12px 28px -8px rgba(0,0,0,.95)' }}
    >
      {members.map((member) => {
        const ai = isAiJid(member.jid);
        const hasHandle = member.handle !== undefined && member.handle !== '';
        const label = hasHandle
          ? `Mention ${member.name} @${member.handle}`
          : `Mention ${member.name}`;
        return (
          <Pressable
            key={member.jid}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => onSelect(member)}
            className="min-h-[48px] w-full flex-row items-center gap-3 pl-[14px] pr-[10px] active:bg-surface-raised"
          >
            <EntityAvatar person={{ id: member.jid, name: member.name }} ai={ai} size={30} />
            <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
              <Text numberOfLines={1} className="min-w-0 shrink text-[16px] text-foreground">
                {member.name}
              </Text>
              {ai ? <AiBadge /> : null}
            </View>
            {hasHandle ? (
              <Text numberOfLines={1} className="shrink-0 font-mono text-[12px] text-[#8a8a8a]">
                @{member.handle}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
